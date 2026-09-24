#!/usr/bin/env python3
"""Linux full database backup. No schema initialization or disk provisioning."""
import argparse
import datetime as dt
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import uuid


class BackupError(Exception):
    pass


def atomic_json(path, data):
    temporary=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('x',encoding='utf-8') as stream:
        json.dump(data,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
    temporary.replace(path)


def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b''):h.update(chunk)
    return h.hexdigest()


def command(args):
    # Tool stderr can include connection details. Surface only the failing tool.
    result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
    if result.returncode:raise BackupError('command_failed:'+Path(args[0]).name)
    return result.stdout.decode('utf-8').strip()


def load_config(path):
    if path.stat().st_mode & 0o077:raise BackupError('config_must_be_0600')
    values={}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        key,value=line.split('=',1);values[key.strip()]=value.strip().strip('"').strip("'")
    for key in ('DATABASE','MYSQL_CONTAINER','MYSQL_CLIENT_CNF','PRIMARY_DIR','SECONDARY_DIR','SECONDARY_MOUNT','SECONDARY_UUID','STATE_DIR'):
        if not values.get(key):raise BackupError('missing_config:'+key)
    if not re.fullmatch(r'[A-Za-z0-9_]+',values['DATABASE']):raise BackupError('invalid_database_name')
    for key in ('PRIMARY_DIR','SECONDARY_DIR','SECONDARY_MOUNT','STATE_DIR','MYSQL_CLIENT_CNF'):
        if not Path(values[key]).is_absolute():raise BackupError('absolute_path_required:'+key)
    return values


def mounted_devices(config):
    first=Path(config['PRIMARY_DIR']).resolve();second=Path(config['SECONDARY_DIR']).resolve()
    mount=Path(config['SECONDARY_MOUNT']).resolve()
    if not first.is_dir() or not second.is_dir():raise BackupError('backup_directories_missing')
    if second!=mount and mount not in second.parents:raise BackupError('secondary_outside_mount')
    info=json.loads(command(['findmnt','--json','--target',str(mount),'--output','TARGET,UUID,SOURCE']))['filesystems'][0]
    if Path(info['target']).resolve()!=mount or info.get('uuid')!=config['SECONDARY_UUID']:
        raise BackupError('secondary_mount_or_uuid_mismatch')
    if first.stat().st_dev==second.stat().st_dev:raise BackupError('same_device')
    # Different partitions of a single disk are not independent copies.
    physical=[]
    for directory in (first,second):
        source=command(['findmnt','--noheadings','--target',str(directory),'--output','SOURCE'])
        rows=command(['lsblk','--inverse','--noheadings','--raw','--output','NAME,TYPE',source]).splitlines()
        disks={r.split()[0] for r in rows if len(r.split())==2 and r.split()[1]=='disk'}
        if not disks:raise BackupError('physical_device_unresolved')
        physical.append(disks)
    if physical[0]&physical[1]:raise BackupError('same_physical_disk')
    return first,second


def mysql(config,sql):
    return command(['docker','exec',config['MYSQL_CONTAINER'],'mysql',
                    '--defaults-extra-file='+config['MYSQL_CLIENT_CNF'],'--batch','--skip-column-names','-e',sql])


def preflight(config):
    first,second=mounted_devices(config)
    version=mysql(config,'SELECT VERSION()')
    tool=command(['docker','exec',config['MYSQL_CONTAINER'],'mysqldump','--version'])
    if not version.startswith('8.4.') or not re.search(r'\b8\.4\.',tool):raise BackupError('mysql_8_4_required')
    db=config['DATABASE']
    engines=mysql(config,f"SELECT DISTINCT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA='{db}' AND TABLE_TYPE='BASE TABLE'").splitlines()
    if not engines or any(e!='InnoDB' for e in engines):raise BackupError('nontransactional_or_empty_database')
    size=int(mysql(config,f"SELECT COALESCE(SUM(DATA_LENGTH+INDEX_LENGTH),0) FROM information_schema.TABLES WHERE TABLE_SCHEMA='{db}'"))
    needed=max(int(config.get('MIN_FREE_BYTES',1073741824)),size*2)
    if any(shutil.disk_usage(p).free<needed for p in (first,second)):raise BackupError('insufficient_space')
    return first,second,version,tool


def dump(config,path):
    args=['docker','exec',config['MYSQL_CONTAINER'],'mysqldump','--defaults-extra-file='+config['MYSQL_CLIENT_CNF'],
          '--single-transaction','--quick','--routines','--events','--triggers','--hex-blob',
          '--no-tablespaces','--set-gtid-purged=OFF','--skip-add-locks',config['DATABASE']]
    # No shell pipeline: separately check the dump exit status and gzip writer.
    process=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
    try:
        with path.open('xb') as raw:
            with gzip.GzipFile(fileobj=raw,mode='wb') as compressed:shutil.copyfileobj(process.stdout,compressed,1024*1024)
            raw.flush();os.fsync(raw.fileno())
        if process.wait()!=0:raise BackupError('dump_failed')
    except BaseException:
        if process.poll() is None:process.kill()
        process.wait();raise
    finally:process.stdout.close()


def verify(path,manifest=None):
    manifest=manifest or json.loads(Path(str(path)+'.manifest.json').read_text())
    if not isinstance(manifest,dict) or manifest.get('format')!='erp-full-backup-v1':raise BackupError('invalid_manifest')
    if path.stat().st_size!=manifest.get('size_bytes') or digest(path)!=manifest.get('sha256'):raise BackupError('checksum_mismatch')
    total=0
    try:
        with gzip.open(path,'rb') as stream:
            for chunk in iter(lambda:stream.read(1024*1024),b''):total+=len(chunk)
    except (OSError,EOFError) as exc:raise BackupError('invalid_gzip') from exc
    if not total or total!=manifest.get('uncompressed_bytes'):raise BackupError('empty_or_incomplete_dump')
    return manifest


def publish_dump(config,first,version,tool):
    instant=dt.datetime.now(dt.timezone.utc)
    stem='erp-full-'+instant.strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8]+'.sql.gz'
    path=first/stem;temp=first/(stem+'.tmp')
    try:
        dump(config,temp)
        with gzip.open(temp,'rb') as stream:total=sum(len(c) for c in iter(lambda:stream.read(1024*1024),b''))
        manifest={'format':'erp-full-backup-v1','database':config['DATABASE'],'created_at':instant.isoformat(),
                  'mysql_version':version,'dump_version':tool,'sha256':digest(temp),'size_bytes':temp.stat().st_size,
                  'uncompressed_bytes':total,'id':stem}
        verify(temp,manifest);temp.replace(path);atomic_json(Path(str(path)+'.manifest.json'),manifest)
        return path,manifest
    finally:temp.unlink(missing_ok=True)


def copy_backup(path,second,manifest):
    destination=second/path.name;temp=second/(path.name+'.tmp')
    try:
        with path.open('rb') as src,temp.open('xb') as dst:
            shutil.copyfileobj(src,dst,1024*1024);dst.flush();os.fsync(dst.fileno())
        verify(temp,manifest);temp.replace(destination)
        atomic_json(Path(str(destination)+'.manifest.json'),manifest)
        verify(destination)
    finally:temp.unlink(missing_ok=True)


def retained_ids(manifests,now,daily_days=30,weekly_weeks=12):
    keep=set();weeks={}
    for name,m in sorted(manifests.items(),key=lambda x:x[1]['created_at'],reverse=True):
        created=dt.datetime.fromisoformat(m['created_at']);age=(now-created).total_seconds()/86400
        if age<daily_days:keep.add(name)
        week=created.isocalendar()[:2]
        if age<weekly_weeks*7 and week not in weeks:weeks[week]=name;keep.add(name)
    return keep


def rotate(first,second,config,current):
    # Delete only verified pairs generated by this tool, never orphans, unknown
    # files, the new pair, or a lone surviving copy.
    pairs={}
    for file in first.glob('erp-full-*.sql.gz'):
        try:
            a=verify(file);b=verify(second/file.name)
            if a==b and a['id']==file.name and a['database']==config['DATABASE']:pairs[file.name]=a
        except Exception:continue
    keep=retained_ids(pairs,dt.datetime.now(dt.timezone.utc),max(1,int(config.get('DAILY_DAYS',30))),max(1,int(config.get('WEEKLY_WEEKS',12))))|{current}
    for name in pairs.keys()-keep:
        for root in (first,second):
            (root/name).unlink();Path(str(root/name)+'.manifest.json').unlink()


def run_backup(config):
    state=Path(config['STATE_DIR']);state.mkdir(mode=0o700,parents=True,exist_ok=True)
    primary=None
    try:
        first,second,version,tool=preflight(config)
        primary,manifest=publish_dump(config,first,version,tool)
        # Recheck the mount immediately before copying and before success.
        mounted_devices(config);copy_backup(primary,second,manifest);mounted_devices(config)
        success={'status':'success','completed_at':dt.datetime.now(dt.timezone.utc).isoformat(),'file':primary.name,'sha256':manifest['sha256'],'database':config['DATABASE']}
        atomic_json(state/'last-success.json',success);atomic_json(state/'status.json',success)
        rotate(first,second,config,primary.name)
        return success
    except Exception as exc:
        status={'status':'partial' if primary else 'failed','time':dt.datetime.now(dt.timezone.utc).isoformat(),
                'primary_file':primary.name if primary else None,'error':str(exc) if isinstance(exc,BackupError) else type(exc).__name__}
        atomic_json(state/'status.json',status)
        raise BackupError(status['error']) from exc


def check_age(config):
    first,second=mounted_devices(config)
    success=json.loads((Path(config['STATE_DIR'])/'last-success.json').read_text())
    if success.get('database')!=config['DATABASE']:raise BackupError('last_backup_database_mismatch')
    name=success['file']
    if Path(name).name!=name:raise BackupError('invalid_status_path')
    completed=dt.datetime.fromisoformat(success['completed_at'])
    age=(dt.datetime.now(dt.timezone.utc)-completed).total_seconds()
    if age<0 or age>26*3600:raise BackupError('backup_older_than_26_hours')
    for root in (first,second):
        if verify(root/name)['sha256']!=success['sha256']:raise BackupError('last_backup_changed')
    return {'status':'healthy','age_hours':round(age/3600,2),'file':name}


def notify_failure(config,failure):
    status=Path(config['STATE_DIR'])/'health.json';atomic_json(status,failure)
    hook=config.get('NOTIFY_HOOK','')
    if hook:
        try:subprocess.run([hook,str(status)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,check=False,timeout=15)
        except (OSError,subprocess.TimeoutExpired):pass


def main():
    parser=argparse.ArgumentParser();parser.add_argument('action',choices=['full','verify','check']);parser.add_argument('file',nargs='?');parser.add_argument('--config',default='/etc/erp-ledger-backup/backup.env');args=parser.parse_args()
    os.umask(0o077)
    try:
        if args.action=='verify':result=verify(Path(args.file))
        else:
            import fcntl
            config=load_config(Path(args.config));state=Path(config['STATE_DIR']);state.mkdir(mode=0o700,parents=True,exist_ok=True)
            with (state/'backup.lock').open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                result=run_backup(config) if args.action=='full' else check_age(config)
                if args.action=='check':atomic_json(state/'health.json',result)
        print(json.dumps(result,ensure_ascii=False));return 0
    except Exception as exc:
        failure={'status':'failed','error':str(exc) if isinstance(exc,BackupError) else type(exc).__name__}
        if 'config' in locals():
            notify_failure(config,failure)
        print(json.dumps(failure),file=sys.stderr);return 1


if __name__=='__main__':sys.exit(main())
