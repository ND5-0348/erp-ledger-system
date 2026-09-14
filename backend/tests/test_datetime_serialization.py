from datetime import date, datetime, timezone

from app.serializers import clean_value, clean_row


def test_database_beijing_time_has_explicit_offset():
    assert clean_value(datetime(2026, 9, 14, 14, 33, 18)) == '2026-09-14T14:33:18+08:00'


def test_aware_time_keeps_its_offset_and_business_date_is_unchanged():
    assert clean_value(datetime(2026, 9, 14, 6, 33, 18, tzinfo=timezone.utc)) == '2026-09-14T06:33:18+00:00'
    assert clean_value(date(2026, 9, 14)) == '2026-09-14'


def test_view_string_timestamp_gets_same_offset_as_log_datetime():
    row = clean_row({'last_modified_at': '2026-09-14 15:34:34',
                     'created_at': datetime(2026, 9, 14, 15, 34, 34),
                     'project_name': '2026-09-14 15:34:34'})
    assert row['last_modified_at'] == row['created_at'] == '2026-09-14T15:34:34+08:00'
    assert row['project_name'] == '2026-09-14 15:34:34'


def test_view_timestamp_preserves_explicit_timezone_and_null():
    assert clean_row({'last_modified_at': None})['last_modified_at'] is None
    assert clean_row({'last_modified_at': '2026-09-14T07:34:34+00:00'})['last_modified_at'] == '2026-09-14T07:34:34+00:00'
