"""Bounded public-source checks. Matching text is NOT a fresh factual verification."""
import argparse
import asyncio
import hashlib
import io
import json
import os
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit
from urllib.robotparser import RobotFileParser
import httpx
from pypdf import PdfReader
from pypdf.errors import PdfReadError

AGENT='BMWResearchSourceCheck/1.0'
MAX_BYTES=3_000_000
LOCK=asyncio.Lock()

def checks_path(): return Path(os.getenv('MARKET_SOURCE_CHECKS','backend/data/market-source-checks.json'))

class TextOnly(HTMLParser):
    def __init__(self):super().__init__();self.skip=0;self.parts=[]
    def handle_starttag(self,tag,attrs):
        if tag in ('script','style','noscript'):self.skip+=1
    def handle_endtag(self,tag):
        if tag in ('script','style','noscript'):self.skip=max(0,self.skip-1)
    def handle_data(self,data):
        if not self.skip:self.parts.append(data)

def extract(body,content_type):
    if 'pdf' in content_type:
        doc=PdfReader(io.BytesIO(body))
        if len(doc.pages)>30:raise ValueError('Document exceeds page limit')
        return ' '.join(page.extract_text() or '' for page in doc.pages)
    if 'html' not in content_type and 'text/plain' not in content_type:raise ValueError('Unsupported public document type')
    parser=TextOnly();parser.feed(body.decode('utf-8',errors='replace'));return ' '.join(parser.parts)

async def bounded_get(client,url):
    async with client.stream('GET',url,follow_redirects=False) as response:
        response.raise_for_status()  # Redirects are intentionally not followed.
        chunks=[];size=0
        async for chunk in response.aiter_bytes():
            size+=len(chunk)
            if size>MAX_BYTES:raise ValueError('Source exceeds size limit')
            chunks.append(chunk)
        return b''.join(chunks),response.headers.get('content-type','')

async def inspect_source(client,record,anchors):
    result={'checked_at':datetime.now(timezone.utc).isoformat(),'source_uri':record['source_uri'],'status':'unavailable'}
    try:
        async with asyncio.timeout(18):
            url=record['source_uri'];parts=urlsplit(url)
            if parts.scheme!='https' or parts.username or parts.port not in (None,443):raise ValueError('Invalid approved source URL')
            robots=f'https://{parts.netloc}/robots.txt'
            try:
                body,_=await bounded_get(client,robots)
                rules=RobotFileParser();rules.parse(body.decode('utf-8',errors='replace').splitlines())
                if not rules.can_fetch(AGENT,url):return {**result,'status':'blocked','detail':'Publisher robots policy disallows this fetch.'}
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code not in (404,410):raise
            body,kind=await bounded_get(client,url)
            content=' '.join(extract(body,kind).casefold().split())
            missing=[a for a in anchors if ' '.join(a.casefold().split()) not in content]
            return {**result,'status':'needs_review' if missing else 'text_matched','sha256':hashlib.sha256(body).hexdigest(),'missing_anchors':missing,'detail':'Expected text missing; manually review the source.' if missing else 'Expected text found. This is a retrieval check, not semantic fact verification.'}
    except (httpx.HTTPError,ValueError,TimeoutError,OSError,PdfReadError) as exc:
        return {**result,'detail':f'Fetch unavailable ({type(exc).__name__}); prior review date unchanged.'}

async def refresh(ids):
    from backend.market.catalog import load_catalog
    catalog=load_catalog();rules=catalog.get('source_checks',{})
    by_id={r['id']:r for r in catalog['records']}
    if not ids or len(ids)>12 or any(eid not in rules for eid in ids):raise ValueError('Select only catalog sources with an approved text-check rule (maximum 12).')
    async with LOCK:
        path=checks_path()
        try:checks=json.loads(path.read_text())
        except (OSError,ValueError):checks={}
        async with httpx.AsyncClient(timeout=10,headers={'User-Agent':AGENT},trust_env=False) as client:
            for eid in dict.fromkeys(ids):
                previous=checks.get(eid)
                if previous and (datetime.now(timezone.utc)-datetime.fromisoformat(previous['checked_at'])).total_seconds()<60:continue
                # Approved claim anchors only; fetching cannot renew factual review dates.
                checks[eid]=await inspect_source(client,by_id[eid],rules[eid]['anchors'])
        path.parent.mkdir(parents=True,exist_ok=True)
        temp=path.with_suffix('.tmp');temp.write_text(json.dumps(checks,indent=2));temp.replace(path)
        return {eid:checks[eid] for eid in ids}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('evidence_ids',nargs='+');args=parser.parse_args()
    print(json.dumps(asyncio.run(refresh(args.evidence_ids)),indent=2))
