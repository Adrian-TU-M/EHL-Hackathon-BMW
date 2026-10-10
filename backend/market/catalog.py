"""Dated market snapshots and deterministic calculations, never LLM arithmetic."""
import json
import os
from datetime import date
from pathlib import Path
from backend.schemas.evidence import EvidenceRecord

TOPICS = ('Electrification', 'Charging', 'Digital experience', 'Regional demand', 'Feature trends')

def catalog_path():
    return Path(os.getenv('MARKET_INDEX', 'backend/data/market.json'))

def load_catalog():
    data = json.loads(catalog_path().read_text())
    if data.get('version') != 1: raise ValueError('Unsupported market index')
    records = [EvidenceRecord.model_validate(r) for r in data['records']]
    if len({r.id for r in records}) != len(records): raise ValueError('Duplicate market evidence ID')
    return data

def eligible(record, scope, topic=None):
    if record.market not in (scope.market, 'Global'): return False
    if record.source_type == 'customer_study' and record.model != scope.vehicle: return False
    if record.source_type == 'planning_volume' and record.model not in (scope.vehicle, 'G60_G68' if scope.vehicle=='G60' else scope.vehicle): return False
    if record.source_type == 'industry_signal':
        if record.reference_status != 'current_reference': return False
        if record.published_on and record.published_on > date.today(): return False
        if not record.verified_on or not record.review_due_on or not record.verified_on <= date.today() <= record.review_due_on: return False
        if topic and topic != 'Regional demand' and topic not in record.categories: return False
    return True

def feature_for(feature_id):
    if not feature_id: return None
    feature=next((f for f in load_catalog().get('features',[]) if f['id']==feature_id),None)
    if not feature: raise ValueError('Unknown feature focus')
    return feature

def records_for(scope, topic=None, feature_id=None):
    feature=feature_for(feature_id)
    records=[r for item in load_catalog()['records'] if eligible(r:=EvidenceRecord.model_validate(item),scope, None if feature else topic)]
    checks=source_checks()
    records=[r for r in records if checks.get(r.id,{}).get('status')!='needs_review']
    if feature:
        records=[r for r in records if r.id in feature['evidence_ids'] or r.source_type in ('market_metric','planning_volume') or (r.source_type=='customer_study' and set(r.categories)&set(feature['study_tags']))]
        records.sort(key=lambda r:(r.id not in feature['evidence_ids'],r.source_type!='customer_study'))
    elif topic and topic != 'Feature trends': records=[r for r in records if r.source_type!='customer_study']
    return records

def search(scope, topic, query, limit=5, feature_id=None):
    words=set(query.lower().split())
    records=records_for(scope,topic,feature_id)
    return sorted(records,key=lambda r:(-len(words & set((' '.join(r.categories)+' '+r.passage).lower().split())),r.id))[:limit]

def change(previous, current):
    if previous is None or current is None or previous == 0: return None
    return round((current-previous)/previous*100, 2)

def dashboard(scope):
    data=load_catalog()
    series=[s for s in data['series'] if s['market']==scope.market and (s['level']=='group' or s['model'] in (scope.vehicle, 'G60_G68' if scope.vehicle=='G60' else scope.vehicle))]
    records=records_for(scope)
    return {'as_of':data['as_of'], 'series':series,
        'signals':[s for s in data['signals'] if s['evidence_id'] in {r.id for r in records}],
        'evidence':[r.model_dump(mode='json') for r in records],
        'features':[{**f,'examples':[e for e in f['examples'] if e['evidence_id'] in {r.id for r in records}], 'study_ids':[r.id for r in records if r.source_type=='customer_study' and set(r.categories)&set(f['study_tags'])]} for f in data.get('features',[])],
        'source_checks': source_checks(),
        'coverage':data['coverage']}


def source_checks():
    from backend.market.refresh import checks_path
    try: return json.loads(checks_path().read_text())
    except (OSError,ValueError): return {}
