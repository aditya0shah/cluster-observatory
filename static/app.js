let cluster = localStorage.getItem('observatory-cluster') || 'klone';
if (!['klone','tillicum'].includes(cluster)) cluster='klone';
let data = null;
const $ = id => document.getElementById(id);
const esc = x => String(x ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const supportedGpu = name => /(?:^|[-:,])(?:a40|a100|l40s?|h100|h200|b100|b200|b300|gb200|gb300)(?=$|[-:,])/i.test(name);
const badge = state => `<span class="badge ${esc(state.toLowerCase().split(' ')[0])}">${esc(state)}</span>`;
const age = date => { if(!date)return 'never'; const s=Math.max(0,Math.floor((Date.now()-Date.parse(date))/1000));return s<60?`${s}s ago`:s<3600?`${Math.floor(s/60)}m ago`:`${Math.floor(s/3600)}h ago`; };
function parseStorage(reports){
 const personal=[],shared=[];
 for(const report of reports||[]){
  if(report.command!=='hyakstorage'||!report.output)continue;
  let path='',block=null;
  for(const line of report.output.split('\n')){
   const heading=line.match(/Usage report for (\/\S+)/);
   if(heading){path=heading[1];block=null;continue;}
   const cells=line.includes('│')?line.split('│').slice(1,-1).map(x=>x.trim()):[];
   if(cells.length===1&&cells[0].startsWith('/')){path=cells[0];continue;}
   if(cells.length===3&&cells[0]==='Total:'){
    const disk=cells[1].split(/\s*\/\s*/),files=cells[2].replace(/ files$/,'').split(/\s*\/\s*/);
    block={path,used:disk[0],limit:disk[1],files:files[0],fileLimit:files[1]};
    if(/\/home(?:\/|$)/.test(path))personal.push({...block});else shared.push(block);
   }
   if(cells.length===3&&cells[0]==='My usage:')personal.push({path,used:cells[1],files:cells[2].replace(/ files$/,''),sharedLimit:block?.limit});
   if(cells.length===6&&['User','Fileset','Group'].includes(cells[0])){
    const item={path,used:cells[2],limit:cells[3]==='-'?null:cells[3],files:cells[5],percent:cells[4]};
    if(cells[0]==='User')personal.push(item);else shared.push(item);
   }
  }
 }
 for(const p of personal)if(!p.limit&&!p.sharedLimit)p.sharedLimit=shared.find(g=>g.path===p.path)?.limit;
 return {personal,shared};
}
function storageBytes(value){
 const m=String(value??'').trim().match(/^(\d+(?:\.\d+)?)\s*([KMGTPE]?)(?:i?B)?$/i);
 return m?Number(m[1])*1024**('KMGTPE'.indexOf(m[2].toUpperCase())+1):NaN;
}
function storagePercent(item){
 const limit=storageBytes(item.limit||item.sharedLimit),used=storageBytes(item.used);
 if(!Number.isFinite(used)||!Number.isFinite(limit)||limit<=0)return '';
 const ratio=100*used/limit;
 const number=ratio>0&&ratio<0.1?'<0.1':ratio.toFixed(1).replace(/\.0$/,'');
 return number+'%';
}
function personalPercentage(p){
 const pct=p.limit&&p.percent?p.percent:storagePercent(p);
 if(!pct)return '<div class="storage-percentage unavailable">Quota percentage unavailable</div>';
 return `<div class="storage-percentage">${esc(pct)} <span>of ${p.limit?'your personal quota':'shared account quota'}</span></div>`;
}
function storageMarkup(storage){
 const {personal,shared}=parseStorage(storage?.reports);
 const summary=personal.length?`<div class="storage-label">YOUR PERSONAL USAGE</div><div class="personal-storage">${personal.map(p=>`<div class="personal-storage-card"><div class="storage-path">${esc(p.path)}</div><div class="personal-storage-value">${esc(p.used)}<span>used by you</span></div>${personalPercentage(p)}<div class="storage-meta">${esc(p.files||'—')} files${p.fileLimit?' / '+esc(p.fileLimit):''}${p.limit?' · '+esc(p.limit)+' personal quota':''}</div></div>`).join('')}</div><p class="storage-note">Personal usage reported by the cluster. Each location is shown separately.</p>`:'<div class="empty">'+(storage?'Personal usage was not reported for these locations. The full quota report is below.':'Check storage to load your personal usage and account quotas.')+'</div>';
 const quotas=shared.length?`<div class="storage-label">SHARED ACCOUNT TOTALS · ALL MEMBERS</div><div class="table-wrap"><table><thead><tr><th>Location</th><th>Account used / quota</th><th>Account files</th></tr></thead><tbody>${shared.map(p=>`<tr><td>${esc(p.path)}</td><td>${esc(p.used)} / ${esc(p.limit||'—')}<span class="secondary">${esc(p.percent||storagePercent(p)||'—')} of account quota</span></td><td>${esc(p.files||'—')}${p.fileLimit?' / '+esc(p.fileLimit):''}</td></tr>`).join('')}</tbody></table></div><p class="storage-note">Shared totals include other users. They are separate from your personal usage above; personal figures are shown only where reported.</p>`:'';
 const raw=storage?.reports?.length?`<details class="storage-raw"><summary>Full quota report & filesystem capacity</summary>${storage.reports.map(r=>`<h3>${esc(r.command||'Storage check')}</h3><pre>${esc(r.output||r.error)}</pre>`).join('')}</details>`:'';
 return summary+quotas+raw;
}
function render(){
 if(!data)return;
 document.querySelector('.aside-bottom small').textContent=data.route+' · read only';
 const refreshSeconds=data.refresh_seconds||120;
 const refreshLabel=refreshSeconds%60===0?`${refreshSeconds/60} min`:`${refreshSeconds}s`;
 const c=data.clusters[cluster], s=c.snapshot, stale=!c.connected || !s || Date.now()-Date.parse(s.collected_at)>refreshSeconds*3000;
 document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t.dataset.cluster===cluster));
 for(const k of ['klone','tillicum']) $('dot-'+k).classList.toggle('online',!!data.clusters[k].connected);
 $('title').textContent=cluster==='klone'?'Klone':'Tillicum';
 $('subtitle').textContent=s?`${s.user} · ${s.host} · Your cluster at a glance`:'Your cluster at a glance';
 $('connection').className=stale?'warning':'';
 $('connection').innerHTML=stale?`<strong>${c.connected?'Reading is stale':'Cluster connection unavailable'}</strong> · ${s?'Showing last successful data from '+esc(age(s.collected_at))+'.':'Waiting for your first authenticated session.'}<br>${esc(c.error || 'Waiting for the next successful update.')}<br>Authenticate in a ${data.backend==='labpc'?'lab PC':'server host'} terminal:<br><code>${esc(data.login_commands?.[cluster]||'Reconnect SSH')}</code>`:`<span class="status-dot"></span>Live · ${esc(data.route)} · Updated ${esc(age(s.collected_at))} · Refreshes every ${refreshLabel}`;
 const u=s?.usage;
 $('metrics').innerHTML=[['Nodes in use',u?.nodes,'Distinct allocated nodes'],['GPUs allocated',u?.gpus,'Your active jobs'],['CPUs allocated',u?.cpus,'Your active jobs'],['Running jobs',u?.running,'Including completing / suspended'],['Pending jobs',u?.pending,'Waiting in the queue']].map(([a,b,d])=>`<div class="metric"><div class="metric-label">${a}</div><div class="metric-value">${b??'—'}</div><div class="metric-sub">${d}</div></div>`).join('');
 const jobs=(s?.jobs||[]).filter(j=>Object.values(j).join(' ').toLowerCase().includes($('job-search').value.toLowerCase()));
 $('job-count').textContent=s?.jobs.length??'—';
 $('jobs').innerHTML=jobs.map(j=>`<tr><td><div class="job-name">${esc(j.name)}</div><span class="secondary">${esc(j.id)} · ${esc(j.account)}</span></td><td>${badge(j.state)}</td><td>${esc(j.partition)}</td><td>${j.nodes} node · ${j.gpus} GPU<span class="secondary">${j.cpus} CPUs</span></td><td>${esc(j.elapsed)}<span class="secondary">of ${esc(j.limit)}</span></td><td>${esc(j.reason)}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">'+(s?'No matching jobs.':'Connect to load your job queue.')+'</td></tr>';
 const groups={};
 for(const allocation of s?.allocations||[]){
  if(!allocation.total.gpus || !supportedGpu(allocation.partition))continue;
  (groups[allocation.account] ||= []).push(allocation);
 }
 $('availability').innerHTML=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b)).map(([account,rows])=>{
  const sum=(key,resource)=>rows.reduce((n,a)=>n+a[key][resource],0);
  return `<section class="allocation-group"><div class="allocation-group-head"><h3>${esc(account)}</h3><span>${sum('free','gpus')} / ${sum('total','gpus')} GPUs free · ${sum('free','cpus')} / ${sum('total','cpus')} CPUs free</span></div><div class="table-wrap"><table class="allocation-table"><thead><tr><th>Partition / Slurm account</th><th>Resource</th><th>Total allocation</th><th>Account used</th><th>Yours</th><th>Free to account</th></tr></thead><tbody>${rows.map(a=>{
   const matching=(s?.jobs||[]).filter(j=>['RUNNING','COMPLETING','SUSPENDED'].includes(j.state)&&j.account===a.partition+'-'+a.account);
   const mine=key=>matching.reduce((n,j)=>n+j[key],0);
   const resource=(key,label,own)=>`<tr><td>${label}</td><td>${esc(a.total[key])}</td><td>${esc(a.used[key])}</td><td>${own}</td><td class="free-value ${key==='gpus'&&!a.free[key]?'exhausted':''}">${esc(a.free[key])}</td></tr>`;
   return `<tr><td rowspan="${a.total.gpus?3:2}" class="allocation-partition"><strong>${esc(a.partition)}</strong><span class="secondary">${esc(a.partition+'-'+a.account)}</span>${a.total.gpus?`<progress class="bar" max="${a.total.gpus}" value="${Math.max(0,a.free.gpus)}" aria-label="${esc(account+' '+a.partition)} GPUs free"></progress><span class="allocation-state ${a.free.gpus?'':'exhausted'}">${a.free.gpus?a.free.gpus+' GPUs free':'GPU allocation full'}</span>`:''}</td><td>${a.total.gpus?'GPUs':'CPUs'}</td><td>${a.total.gpus?a.total.gpus:a.total.cpus}</td><td>${a.total.gpus?a.used.gpus:a.used.cpus}</td><td>${mine(a.total.gpus?'gpus':'cpus')}</td><td class="free-value ${a.total.gpus&&!a.free.gpus?'exhausted':''}">${a.total.gpus?a.free.gpus:a.free.cpus}</td></tr>${a.total.gpus?resource('cpus','CPUs',mine('cpus')):''}${resource('memory','Memory','—')}`;
  }).join('')}</tbody></table></div></section>`;
 }).join('') || `<div class="empty">${esc(s?.allocation_error|| (s?'No matching account allocations.':'Connect to load your account allocations.'))}</div>`;
 const checkpointModels={};
 for(const n of s?.nodes||[]){
  if(!n.gpus || !supportedGpu(n.gres) || !n.partitions.some(p=>p.startsWith('ckpt')))continue;
  const model=n.gres.match(/gpu:([^:,]+)/)?.[1]?.toUpperCase()||'GPU';
  const pool=checkpointModels[model] ||= {free:0,total:0};
  pool.total+=n.gpus;
  if(n.schedulable)pool.free+=Math.max(0,n.gpus-n.allocated_gpus);
 }
 if(Object.keys(checkpointModels).length){
  $('availability').innerHTML+=`<div class="checkpoint-summary"><span class="badge">SHARED / PREEMPTIBLE</span><strong>Checkpoint GPU pool</strong>${Object.entries(checkpointModels).sort(([a],[b])=>a.localeCompare(b)).map(([model,pool])=>`<span>${esc(model)}: ${pool.free} / ${pool.total} GPUs free</span>`).join('')}<p>A40 / L40 and newer GPU classes only. Outside your owned allocation; shared jobs can be interrupted. Accounts: ${esc((s.accounts||[]).filter(([a])=>a.startsWith('ckpt-')).map(([a])=>a).join(', ')||'No checkpoint associations reported')}.</p></div>`;
 }
 $('accounts').innerHTML=(s?.accounts||[]).map(([a,p,q])=>`<div class="account">${esc(a)}<span class="secondary">${esc(p||'No partition restriction in association')} · QoS: ${esc(q||'—')}</span></div>`).join('')||'<div class="empty">No associations available.</div>';
 if(s?.warnings?.length)$('accounts').innerHTML+=`<p>${s.warnings.map(esc).join('<br>')}</p>`;
 $('storage').disabled=!!c.storage_loading;
 $('storage').textContent=c.storage_loading?'Checking…':'Check storage';
 $('storage-time').textContent=c.storage?`Last checked ${age(c.storage.collected_at)} · on demand`:'Check on demand · no directory scans';
 $('storage-results').innerHTML=(c.storage_error?`<p class="warning">${esc(c.storage_error)}</p>`:'')+storageMarkup(c.storage);
 $('recent').innerHTML=(s?.recent||[]).slice().reverse().map(j=>`<tr><td>${esc(j.id)}</td><td>${esc(j.name)}</td><td>${badge(j.state)}</td><td>${esc(j.elapsed)}</td><td>${esc(j.exit_code)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No recent accounting records available.</td></tr>';
 $('updated').textContent=`${refreshLabel} polling · Last successful reading: ${s?age(s.collected_at):'never'}`;
}
async function load(){try{const r=await fetch('/api/status');if(!r.ok)throw Error('Server returned '+r.status);data=await r.json();render();}catch(e){$('connection').className='warning';$('connection').textContent='Local server unreachable. Retrying automatically…';}}
async function action(name){try{const r=await fetch(`/api/${cluster}/${name}`,{method:'POST',headers:{'X-Dashboard':'1'}});if(!r.ok)throw Error('Request failed');await load();}catch(e){$('connection').className='warning';$('connection').textContent=e.message;}}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{cluster=t.dataset.cluster;localStorage.setItem('observatory-cluster',cluster);$('job-search').value='';render();}));
$('refresh').onclick=()=>action('refresh');$('storage').onclick=()=>action('storage');$('job-search').oninput=render;
load();setInterval(load,5000);
