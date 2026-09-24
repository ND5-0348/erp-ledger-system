"""Portable logic/failure tests. These do NOT certify Linux mounts or MySQL 8.4."""
import datetime as dt
import gzip
import importlib.util
import json
from pathlib import Path
import pytest

spec=importlib.util.spec_from_file_location('backup_tool',Path(__file__).resolve().parents[2]/'ops/backup/backup_tool.py')
tool=importlib.util.module_from_spec(spec);spec.loader.exec_module(tool)


@pytest.fixture
def config(tmp_path,monkeypatch):
    first=tmp_path/'first';second=tmp_path/'second';state=tmp_path/'state'
    for p in (first,second,state):p.mkdir()
    config={'PRIMARY_DIR':str(first),'SECONDARY_DIR':str(second),'STATE_DIR':str(state),'DATABASE':'synthetic'}
    monkeypatch.setattr(tool,'preflight',lambda c:(first,second,'8.4.synthetic','mysqldump 8.4.synthetic'))
    monkeypatch.setattr(tool,'mounted_devices',lambda c:(first,second))
    def fake_dump(c,p):
        with gzip.open(p,'wb') as stream:stream.write(b'CREATE TABLE example (id int);\n')
    monkeypatch.setattr(tool,'dump',fake_dump)
    return config


def test_success_verified_both_and_recent(config):
    result=tool.run_backup(config)
    assert result['status']=='success' and tool.check_age(config)['status']=='healthy'
    for root in ('PRIMARY_DIR','SECONDARY_DIR'):assert tool.verify(Path(config[root])/result['file'])['sha256']==result['sha256']


@pytest.mark.parametrize('stage',['preflight','dump','copy_backup'])
def test_failures_preserve_last_success_and_partial_primary(config,monkeypatch,stage):
    old=tool.run_backup(config);success=Path(config['STATE_DIR'])/'last-success.json';before=success.read_bytes()
    def fail(*a):raise tool.BackupError('synthetic_failure')
    monkeypatch.setattr(tool,stage,fail)
    with pytest.raises(tool.BackupError):tool.run_backup(config)
    assert success.read_bytes()==before
    state=json.loads((success.parent/'status.json').read_text())
    assert state['status']==('partial' if stage=='copy_backup' else 'failed')
    if state['primary_file']:tool.verify(Path(config['PRIMARY_DIR'])/state['primary_file'])
    for root in ('PRIMARY_DIR','SECONDARY_DIR'):tool.verify(Path(config[root])/old['file'])


def test_corruption_missing_copy_and_stale_age(config):
    result=tool.run_backup(config);second=Path(config['SECONDARY_DIR'])/result['file']
    second.write_bytes(b'broken')
    with pytest.raises(tool.BackupError):tool.check_age(config)
    result=tool.run_backup(config);status=Path(config['STATE_DIR'])/'last-success.json'
    data=json.loads(status.read_text());data['completed_at']=(dt.datetime.now(dt.timezone.utc)-dt.timedelta(hours=27)).isoformat();tool.atomic_json(status,data)
    with pytest.raises(tool.BackupError,match='26_hours'):tool.check_age(config)


def test_retention_keeps_daily_and_weekly_but_never_orphans(config):
    now=dt.datetime.now(dt.timezone.utc)
    manifests={str(i):{'created_at':(now-dt.timedelta(days=i)).isoformat()} for i in range(120)}
    keep=tool.retained_ids(manifests,now)
    assert all(str(i) in keep for i in range(30)) and '119' not in keep and any(int(i)>30 for i in keep)
    orphan=Path(config['PRIMARY_DIR'])/'erp-full-orphan.sql.gz';orphan.write_bytes(b'preserve')
    tool.run_backup(config);assert orphan.read_bytes()==b'preserve'


def test_missing_mount_and_same_device_fail_before_dump(tmp_path,monkeypatch):
    first=tmp_path/'first';second=tmp_path/'second';first.mkdir();second.mkdir()
    config={'PRIMARY_DIR':str(first),'SECONDARY_DIR':str(second),'SECONDARY_MOUNT':str(second),'SECONDARY_UUID':'expected'}
    monkeypatch.setattr(tool,'command',lambda args:json.dumps({'filesystems':[{'target':str(second),'uuid':'wrong','source':'test'}]}))
    with pytest.raises(tool.BackupError,match='uuid_mismatch'):tool.mounted_devices(config)
    monkeypatch.setattr(tool,'command',lambda args:json.dumps({'filesystems':[{'target':str(second),'uuid':'expected','source':'test'}]}))
    with pytest.raises(tool.BackupError,match='same_device'):tool.mounted_devices(config)


def test_notification_hook_only_gets_status_path_and_failure_is_not_masked(config,monkeypatch):
    calls=[];config['NOTIFY_HOOK']='synthetic-hook'
    def fake_hook(args,**kwargs):
        calls.append(args);raise OSError('hook unavailable')
    monkeypatch.setattr(tool.subprocess,'run',fake_hook)
    tool.notify_failure(config,{'status':'failed','error':'synthetic'})
    assert calls==[['synthetic-hook',str(Path(config['STATE_DIR'])/'health.json')]]
    assert json.loads((Path(config['STATE_DIR'])/'health.json').read_text())['status']=='failed'
