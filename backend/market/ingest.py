"""Read-only import of challenge sales data; published series are curated with page provenance."""
import argparse
import hashlib
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from openpyxl import load_workbook
from backend.market.catalog import change
from backend.market.studies import study_records
from backend.schemas.evidence import EvidenceRecord

def build(data_dir, output):
    curated=json.loads((Path(__file__).resolve().parents[1]/'evidence/market.json').read_text())
    records=curated['records']; series=curated['series']
    workbook_path=data_dir/'sales_volumes.xlsx'
    digest=hashlib.sha256(workbook_path.read_bytes()).hexdigest()
    book=load_workbook(workbook_path,read_only=True,data_only=True)
    now=datetime.now(timezone.utc).isoformat()
    for sheet in book:
        if sheet.title not in ('F70','G60_G68','G70'):raise ValueError('Unexpected sales model group')
        rows=list(sheet.values)
        if rows[0] != ('market','market_code','volume_2024','volume_2025','volume_2030'):raise ValueError('Sales schema changed')
        for row_number,row in enumerate(rows[1:],2):
            market={'USA':'United States'}.get(row[0],row[0])
            if market not in ('Europe','United States','China'):continue
            values=row[2:5]
            if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 for v in values):raise ValueError('Invalid volume')
            eid=f'planning-{sheet.title}-{row[1]}'
            yoy=change(values[0],values[1])
            text=f'Supplied {sheet.title} {market} volume inputs: 2024 = {values[0]:,}; 2025 = {values[1]:,}; 2030 = {values[2]:,} vehicles. '
            text+=(f'Calculated 2024–2025 change: {yoy:+.2f}%.' if yoy is not None else 'Percentage growth is unavailable because the starting value is zero.')
            caveats=['Challenge-provided inputs; historical provenance and future assumptions are not independently verified.', '2030 is a future input, not observed sales or a model-generated forecast.', 'All powertrains combined; zeros do not establish absent demand.']
            if sheet.title=='G60_G68':caveats.append('G60 and G68 are combined in this workbook; not a G60-only statistic.')
            records.append(dict(id=eid,source_type='planning_volume',source_title='Challenge sales volumes',source_uri='local:sales_volumes.xlsx',locator=f'{sheet.title}!A{row_number}:E{row_number}; sha256:{digest}',passage=text,retrieved_at=now,brand='BMW planning inputs',model=sheet.title,market=market,categories=['Regional demand'],caveats=caveats,content_kind='curated_summary'))
            series.append(dict(id=eid,market=market,model=sheet.title,level='model',title=f'{sheet.title} supplied volume inputs',unit='vehicles',evidence_id=eid,yoy=yoy,points=[{'year':year,'value':value,'kind':'planning' if year==2030 else 'supplied'} for year,value in zip([2024,2025,2030],values)]))
    book.close()
    records.extend(study_records(data_dir/'F70_G60_G68_G70_customer_studies.xlsx',now))
    records=[EvidenceRecord.model_validate(r).model_dump(mode='json') for r in records]
    result={**curated,'records':records,'series':series,'imported_at':now}
    output.parent.mkdir(parents=True,exist_ok=True)
    temporary=output.with_suffix('.tmp');temporary.write_text(json.dumps(result,indent=2,ensure_ascii=False));temporary.replace(output)
    print(f'Imported {len(records)} market evidence records and {len(series)} series into {output}')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data-dir',type=Path,required=True);p.add_argument('--output',type=Path,default=Path('backend/data/market.json'));args=p.parse_args();build(args.data_dir,args.output)
