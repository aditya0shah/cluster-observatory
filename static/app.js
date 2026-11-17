let cluster = localStorage.getItem('observatory-cluster') || 'klone';
if (!['klone','tillicum'].includes(cluster)) cluster='klone';
let data = null;
let storageMetric=localStorage.getItem('observatory-storage-metric')||'bytes';
if(!['bytes','files'].includes(storageMetric))storageMetric='bytes';
const expanded={jobs:false,people:false,storage:false};
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
function previewWithYou(items,user,limit,showAll){
 if(showAll||items.length<=limit)return items;
 const preview=items.slice(0,limit), own=items.find(p=>p.user===user);
 if(own&&!preview.includes(own))preview[limit-1]=own;
 return preview;
}
const sizeLabel=value=>String(value??'—').replace(/(\d)([KMGTPE]?i?B)$/i,'$1 $2');
const percentLabel=value=>value>0&&value<.1?'<0.1%':Number(value).toFixed(1).replace(/\.0$/,'')+'%';
function leaderboardMarkup(board,user){
 if(!board)return '<div class="empty">Refresh storage to load the lab-member leaderboard.</div>';
 const notice=componentNotice('Storage leaderboard',board.error,board.collected_at);
 if(board.error&&!board.collected_at)return notice;
 const byFiles=storageMetric==='files';
 const value=m=>byFiles?(m.files??-1):m.used_bytes;
 const members=[...(board.members||[])].sort((a,b)=>value(b)-value(a)||a.user.localeCompare(b.user));
 if(!members.length)return notice+'<div class="empty">No per-member storage records were reported.</div>';
 const ranks=new Map(members.map((p,i)=>[p.user,i+1])), mine=members.find(p=>p.user===user);
 const visible=previewWithYou(members,user,6,expanded.storage);
 const fileTotal=board.used_files??members.reduce((sum,m)=>sum+(m.files??0),0);
 const used=byFiles?fileTotal:board.used_bytes,quota=byFiles?board.quota_files:board.quota_bytes;
 const quotaPercent=quota?100*used/quota:null;
 const countLabel=n=>n==null?'—':Number(n).toLocaleString();
 const amount=m=>byFiles?countLabel(m.files):sizeLabel(m.used);
 const shareLabel=byFiles?(board.used_files==null?'reported member files':'lab files'):'lab usage';
 const tabs=`<div class="storage-metric-tabs" role="tablist" aria-label="Storage leaderboard ranking">${[['bytes','Storage'],['files','Files']].map(([key,label])=>`<button role="tab" id="storage-tab-${key}" data-storage-metric="${key}" aria-controls="storage-leaderboard-panel" aria-selected="${storageMetric===key}" tabindex="${storageMetric===key?0:-1}">${label}</button>`).join('')}</div>`;
 return notice+tabs+`<div id="storage-leaderboard-panel" role="tabpanel" aria-labelledby="storage-tab-${storageMetric}"><div class="storage-board-stats"><span><small>${byFiles?'LAB FILES':'LAB USED / QUOTA'}</small><strong>${esc(byFiles?countLabel(fileTotal):sizeLabel(board.used))}${byFiles?'':`<em> / ${esc(sizeLabel(board.quota))}</em>`}</strong></span><span><small>${byFiles?'FILE QUOTA FILLED':'QUOTA FILLED'}</small><strong>${quotaPercent===null?'—':percentLabel(quotaPercent)}${byFiles?`<em>${quota?' / '+countLabel(quota)+' files':'not reported'}</em>`:''}</strong></span><span><small>YOUR POSITION</small><strong>${mine?'#'+ranks.get(user):'—'}<em>${mine?' · '+esc(amount(mine))+(byFiles?' files':''):''}</em></strong></span><span><small>REPORTED OWNERS</small><strong>${members.length}</strong></span></div><div class="table-wrap storage-rank-scroll"><table class="storage-leaderboard"><thead><tr><th>Rank</th><th>Lab member</th><th>${byFiles?'Files used':'Storage used'}</th><th>Share of ${shareLabel}</th><th>${byFiles?'Storage used':'Files'}</th></tr></thead><tbody>${visible.map(m=>{
  const pct=byFiles?(m.files==null?null:(fileTotal?100*m.files/fileTotal:0)):(m.percent_of_lab_used??(board.used_bytes?100*m.used_bytes/board.used_bytes:0));
  return `<tr class="${m.user===user?'storage-is-you':''}"><td><span class="storage-rank ${ranks.get(m.user)<=3?'top-rank':''}">${String(ranks.get(m.user)).padStart(2,'0')}</span></td><td><strong>${esc(/^\d+$/.test(m.user)?'UID '+m.user:m.user)}</strong>${m.user===user?'<span class="lab-you">YOU</span>':''}</td><td class="storage-amount">${esc(amount(m))}</td><td><div class="storage-share"><progress class="bar" max="100" value="${Math.max(0,Math.min(100,pct??0))}" aria-label="${esc(m.user)} share of ${byFiles?'lab files':'lab used storage'}"></progress><span>${pct===null?'—':percentLabel(pct)}</span></div></td><td class="storage-files">${esc(byFiles?sizeLabel(m.used):countLabel(m.files))}</td></tr>`;
 }).join('')}</tbody></table></div>${members.length>6?`<div class="expand-footer"><button class="expand-button" data-expand="storage">${expanded.storage?'Show less':'Show all '+members.length+' owners'} <span>${expanded.storage?'−':'+'}</span></button></div>`:''}<p class="storage-note">Weirdlab · ${esc(board.path||'')} · percentages are each owner’s share of ${byFiles?shareLabel:'<strong>used</strong> lab storage'}. ${byFiles?'Files are ranked by count.':'Rounded cluster accounting;'} numeric UIDs are unresolved owners.</p></div>`;
}

function allocationMarkup(s,openDetails){
 const groups={};
 for(const a of s?.allocations||[]){if(a.total.gpus&&supportedGpu(a.partition))(groups[a.account] ||= []).push(a);}
 const cards=Object.entries(groups).sort(([a],[b])=>a.localeCompare(b)).map(([account,rows])=>{
  const sum=(kind,key)=>rows.reduce((n,a)=>n+a[kind][key],0);
  return `<section class="allocation-card"><div class="allocation-card-head"><h3>${esc(account)}</h3><span><strong>${sum('free','gpus')}</strong> / ${sum('total','gpus')} free</span></div><div class="allocation-card-rows">${rows.map(a=>{
   const mine=(s.jobs||[]).filter(j=>['RUNNING','COMPLETING','SUSPENDED'].includes(j.state)&&j.account===a.partition+'-'+a.account).reduce((n,j)=>n+j.gpus,0);
   return `<div class="allocation-gpu-row"><strong>${esc(a.partition.replace(/^gpu-/, '').toUpperCase())}</strong><span class="allocation-free ${!a.free.gpus?'exhausted':''}">${a.free.gpus}<small> / ${a.total.gpus} free</small></span><span class="allocation-mine">You <strong>${mine}</strong></span><progress class="bar" max="${a.total.gpus}" value="${Math.max(0,a.free.gpus)}" aria-label="${esc(account+' '+a.partition)} GPUs free"></progress></div>`;
  }).join('')}</div><details class="allocation-extra" data-disclosure="${esc(cluster+':allocation:'+account)}"${openDetails.has(cluster+':allocation:'+account)?' open':''}><summary>CPU & memory details</summary><div class="table-wrap"><table><thead><tr><th>Partition</th><th>Free CPUs</th><th>Free memory</th><th>Used GPUs</th></tr></thead><tbody>${rows.map(a=>`<tr><td>${esc(a.partition)}</td><td>${a.free.cpus} / ${a.total.cpus}</td><td>${esc(a.free.memory)} / ${esc(a.total.memory)}</td><td>${a.used.gpus}</td></tr>`).join('')}</tbody></table></div></details></section>`;
 }).join('');
 const empty=s?.allocations_supported===false?'Account allocation reports are unavailable on this cluster. GPU activity is shown below.':s?.allocation_error?'Account availability is temporarily unavailable.':s?'No matching account allocations.':'Connect to load account allocations.';
 let html=componentNotice('Account availability',s?.allocation_error,s?.allocations_collected_at)+(cards?`<div class="allocation-cards">${cards}</div>`:`<div class="empty">${empty}</div>`);
 const pools={};
 for(const n of s?.nodes||[]){
  if(!n.gpus||!supportedGpu(n.gres)||!n.partitions.some(p=>p.startsWith('ckpt')))continue;
  const model=n.gres.match(/gpu:([^:,]+)/)?.[1]?.toUpperCase()||'GPU',p=pools[model] ||= {free:0,total:0};
  p.total+=n.gpus;if(n.schedulable)p.free+=Math.max(0,n.gpus-n.allocated_gpus);
 }
 if(Object.keys(pools).length)html+=`<div class="checkpoint-summary"><span class="badge">CHECKPOINT / PREEMPTIBLE</span>${Object.entries(pools).sort(([a],[b])=>a.localeCompare(b)).map(([model,p])=>`<span class="checkpoint-resource">${esc(model)} <strong>${p.free}</strong> / ${p.total}</span>`).join('')}</div>`;
 return html;
}

function storageMarkup(storage,user,openDetails=new Set()){
 const {personal,shared}=parseStorage(storage?.reports);
 const summary=personal.length?`<div class="storage-label">YOUR PERSONAL USAGE</div><div class="personal-storage">${personal.map(p=>`<div class="personal-storage-card"><div class="storage-path">${esc(p.path)}</div><div class="personal-storage-value">${esc(p.used)}<span>used by you</span></div>${personalPercentage(p)}<div class="storage-meta">${esc(p.files||'—')} files${p.fileLimit?' / '+esc(p.fileLimit):''}${p.limit?' · '+esc(p.limit)+' personal quota':''}</div></div>`).join('')}</div><p class="storage-note">Personal usage reported by the cluster. Each location is shown separately.</p>`:'<div class="empty">'+(storage?'Personal usage was not reported for these locations. The full quota report is below.':'Check storage to load your personal usage and account quotas.')+'</div>';
 const quotas=shared.length?`<div class="storage-label">SHARED ACCOUNT TOTALS · ALL MEMBERS</div><div class="table-wrap"><table><thead><tr><th>Location</th><th>Account used / quota</th><th>Account files</th></tr></thead><tbody>${shared.map(p=>`<tr><td>${esc(p.path)}</td><td>${esc(p.used)} / ${esc(p.limit||'—')}<span class="secondary">${esc(p.percent||storagePercent(p)||'—')} of account quota</span></td><td>${esc(p.files||'—')}${p.fileLimit?' / '+esc(p.fileLimit):''}</td></tr>`).join('')}</tbody></table></div><p class="storage-note">Shared totals include other users. They are separate from your personal usage above; personal figures are shown only where reported.</p>`:'';
 const raw=storage?.reports?.length?`<details class="storage-raw" data-disclosure="storage-raw"${openDetails.has('storage-raw')?' open':''}><summary>Full quota report & filesystem capacity</summary>${storage.reports.map(r=>`<h3>${esc(r.command||'Storage check')}</h3><pre>${esc(r.output||r.error)}</pre>`).join('')}</details>`:'';
 return leaderboardMarkup(storage?.leaderboard,user||storage?.user)+(personal.length?`<div class="storage-personal-inline">${personal.filter(p=>/\/(home|scrubbed)(\/|$)/.test(p.path)).map(p=>`<span>${/\/home(\/|$)/.test(p.path)?'Home':'Scrubbed'}: ${esc(sizeLabel(p.used))}${p.limit?' / '+esc(sizeLabel(p.limit))+' · '+esc(p.percent||storagePercent(p)):''}</span>`).join('')}</div>`:'')+`<details class="storage-extra" data-disclosure="storage-extra"${openDetails.has('storage-extra')?' open':''}><summary>Your personal quotas & full reports</summary>${summary+quotas+raw}</details>`;
}
function componentNotice(label,error,collectedAt){
 if(!error)return '';
 const message=String(error).includes('timed out')?'The cluster query timed out.':String(error);
 return `<div class="component-warning"><strong>${esc(label)} refresh delayed</strong><span>${esc(message)} Retrying automatically.</span><span>${collectedAt?'Showing the last successful reading from '+esc(age(collectedAt))+'.':'No successful reading is available yet.'}</span></div>`;
}
function weirdlabMarkup(activity,currentUser,openUsers=new Set()){
 if(!activity)return '<div class="empty">Waiting for Weirdlab GPU activity…</div>';
 const notice=componentNotice('GPU activity',activity.error,activity.collected_at);
 if(activity.error&&!activity.collected_at)return notice;
 const people=new Map();
 for(const job of activity.jobs||[]){
  const types=Object.entries(job.gpu_types||{}).filter(([model])=>model==='UNKNOWN'||supportedGpu('gpu-'+model));
  if(!types.length)continue;
  if(!people.has(job.user))people.set(job.user,{user:job.user,jobs:[],models:{},account:0,checkpoint:0});
  const person=people.get(job.user),scope=job.scope==='checkpoint'?'checkpoint':'account';
  const gpus=types.reduce((sum,[,count])=>sum+count,0);
  person[scope]+=gpus;
  person.jobs.push({...job,gpu_types:Object.fromEntries(types),gpus});
  for(const [model,count] of types){
   (person.models[model] ||= {account:0,checkpoint:0})[scope]+=count;
  }
 }
 const users=[...people.values()].sort((a,b)=>(b.account+b.checkpoint)-(a.account+a.checkpoint)||a.user.localeCompare(b.user));
 if(!users.length)return notice+'<div class="empty">No active Weirdlab jobs on the displayed GPU classes.</div>';
 const owned=users.reduce((n,p)=>n+p.account,0),checkpoint=users.reduce((n,p)=>n+p.checkpoint,0);
 return notice+`<div class="lab-overview"><span><strong>${users.length}</strong> people</span><span><strong>${owned}</strong> account GPUs</span><span><strong>${checkpoint}</strong> checkpoint GPUs</span><span class="lab-hint">Expand a person for jobs & nodes</span></div><div class="lab-people">${previewWithYou(users,currentUser,6,expanded.people).map(p=>{
  const key=cluster+':'+p.user;
  const models=Object.entries(p.models).sort(([a],[b])=>a.localeCompare(b));
  const scopeLine=(scope,label)=>p[scope]?`<div class="lab-model-line"><span class="lab-scope ${scope}">${label}</span>${models.filter(([,counts])=>counts[scope]).map(([model,counts])=>`<span class="lab-gpu-chip ${scope}">${esc(model==='UNKNOWN'?'GPU type unknown':model)} <strong>×${counts[scope]}</strong></span>`).join('')}</div>`:'';
  return `<details class="lab-person ${p.user===currentUser?'is-you':''}" data-user="${esc(key)}"${openUsers.has(key)?' open':''}><summary><span class="lab-identity"><span class="lab-avatar" aria-hidden="true">${esc(p.user.slice(0,2).toUpperCase())}</span><span><strong>${esc(p.user)}</strong>${p.user===currentUser?'<span class="lab-you">YOU</span>':''}<span class="secondary">${p.jobs.length} active ${p.jobs.length===1?'job':'jobs'}</span></span></span><span class="lab-models">${scopeLine('account','Account')}${scopeLine('checkpoint','Checkpoint')}</span><span class="lab-person-total"><strong>${p.account+p.checkpoint}</strong><span>GPUs</span></span><span class="lab-chevron" aria-hidden="true">›</span></summary><div class="table-wrap lab-job-details"><table><thead><tr><th>Job</th><th>GPUs</th><th>State</th><th>Nodes</th><th>Slurm account</th></tr></thead><tbody>${p.jobs.map(j=>`<tr><td><span class="job-name">${esc(j.name)}</span><span class="secondary">${esc(j.id)}</span></td><td>${Object.entries(j.gpu_types).map(([model,count])=>`${count} ${esc(model==='UNKNOWN'?'GPU (type unknown)':model)}`).join('<br>')}</td><td>${badge(j.state)}</td><td>${esc(j.nodelist||'—')}</td><td>${esc(j.account)}<span class="secondary">${esc(j.partition)}</span></td></tr>`).join('')}</tbody></table></div></details>`;
 }).join('')}</div>${users.length>6?`<div class="expand-footer"><button class="expand-button" data-expand="people">${expanded.people?'Show less':'Show all '+users.length+' people'} <span>${expanded.people?'−':'+'}</span></button></div>`:''}`;
}
function render(){
 if(!data)return;
 const openDetails=new Set([...document.querySelectorAll('[data-disclosure][open]')].map(el=>el.dataset.disclosure));
 document.querySelector('.aside-bottom small').textContent=data.route+' · read only';
 $('cache-status').hidden=!data.cache_error;
 $('cache-status').textContent=data.cache_error?'Snapshot cache unavailable. Live readings continue to update in memory; saved readings may be lost after a restart.':'';
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
 const search=$('job-search').value.toLowerCase();
 const jobs=(s?.jobs||[]).filter(j=>Object.values(j).join(' ').toLowerCase().includes(search)).sort((a,b)=>Number(b.state!=='PENDING')-Number(a.state!=='PENDING'));
 $('job-count').textContent=s?.jobs.length??'—';
 $('jobs-summary').textContent=`${u?.running??'—'} active · ${u?.pending??'—'} pending · active jobs first`;
 const visibleJobs=expanded.jobs||search?jobs:jobs.slice(0,6);
 $('jobs').innerHTML=visibleJobs.map(j=>`<tr><td><div class="job-name" title="${esc(j.name)}">${esc(j.name)}</div><span class="secondary">${esc(j.id)} · ${esc(j.account)}</span></td><td>${badge(j.state)}</td><td>${j.gpus}<span class="secondary">${j.nodes} node · ${j.cpus} CPUs</span></td><td>${esc(j.elapsed)}<span class="secondary">/ ${esc(j.limit)}</span></td><td class="job-location" title="${esc(j.reason)}">${esc(j.reason)}<span class="secondary">${esc(j.partition)}</span></td></tr>`).join('')||'<tr><td colspan="5" class="empty">'+(s?'No matching jobs.':'Connect to load your job queue.')+'</td></tr>';
 $('jobs-panel').classList.toggle('is-expanded',expanded.jobs||!!search);
 $('jobs-more').innerHTML=jobs.length>6&&!search?`<button class="expand-button" data-expand="jobs">${expanded.jobs?'Show less':'Show all '+jobs.length+' jobs'} <span>${expanded.jobs?'−':'+'}</span></button>`:'';
 $('availability').innerHTML=allocationMarkup(s,openDetails);
 const openLabUsers=new Set([...document.querySelectorAll('#weirdlab-activity details[open]')].map(el=>el.dataset.user));
 $('weirdlab-activity').innerHTML=weirdlabMarkup(s?.weirdlab_gpu_activity,s?.user,openLabUsers);
 $('account-summary').textContent=(s?.accounts?.length??0)+' Slurm associations';
 $('accounts').innerHTML=(s?.accounts||[]).map(([a,p,q])=>`<div class="account">${esc(a)}<span class="secondary">${esc(p||'No partition restriction in association')} · QoS: ${esc(q||'—')}</span></div>`).join('')||'<div class="empty">No associations available.</div>';
 if(s?.warnings?.length)$('accounts').innerHTML+=`<p>${s.warnings.map(esc).join('<br>')}</p>`;
 $('storage').disabled=!!c.storage_loading;
 $('storage').textContent=c.storage_loading?'Checking…':'Refresh storage';
 $('storage-time').textContent=c.storage?`Last checked ${age(c.storage.collected_at)} · on demand`:'Check on demand · no directory scans';
 $('storage-results').innerHTML=(c.storage_error?`<p class="warning">${esc(c.storage_error)}</p>`:'')+storageMarkup(c.storage,s?.user,openDetails);
 const recent=s?.recent||[], failed=recent.filter(j=>/FAILED|OUT_OF_MEMORY|TIMEOUT|NODE_FAIL/.test(j.state));
 $('recent-summary').innerHTML=`${recent.length} records · <span class="${failed.length?'history-failures':''}">${failed.length} failed / timed out</span>`;
 $('recent').innerHTML=(s?.recent||[]).slice().reverse().map(j=>`<tr><td>${esc(j.id)}</td><td>${esc(j.name)}</td><td>${badge(j.state)}</td><td>${esc(j.elapsed)}</td><td>${esc(j.exit_code)}</td></tr>`).join('')||'<tr><td colspan="5" class="empty">No recent accounting records available.</td></tr>';
 $('updated').textContent=`${refreshLabel} polling · Last successful reading: ${s?age(s.collected_at):'never'}`;
}
async function load(){try{const r=await fetch('/api/status');if(!r.ok)throw Error('Server returned '+r.status);data=await r.json();render();}catch(e){$('connection').className='warning';$('connection').textContent='Local server unreachable. Retrying automatically…';}}
async function action(name){try{const r=await fetch(`/api/${cluster}/${name}`,{method:'POST',headers:{'X-Dashboard':'1'}});if(!r.ok)throw Error('Request failed');await load();}catch(e){$('connection').className='warning';$('connection').textContent=e.message;}}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>{cluster=t.dataset.cluster;localStorage.setItem('observatory-cluster',cluster);$('job-search').value='';render();}));
$('refresh').onclick=()=>action('refresh');$('storage').onclick=()=>action('storage');$('job-search').oninput=render;
load();setInterval(load,5000);

document.addEventListener('click',event=>{
 const metricTab=event.target.closest('[data-storage-metric]');
 if(metricTab){selectStorageMetric(metricTab.dataset.storageMetric);return;}
 const button=event.target.closest('[data-expand]');
 if(!button)return;
 const key=button.dataset.expand;
 if(Object.hasOwn(expanded,key)){expanded[key]=!expanded[key];render();}
});

function selectStorageMetric(metric){
 if(!['bytes','files'].includes(metric))return;
 storageMetric=metric;
 localStorage.setItem('observatory-storage-metric',metric);
 render();
 document.querySelector('[data-storage-metric="'+metric+'"]')?.focus();
}
document.addEventListener('keydown',event=>{
 const tab=event.target.closest('[data-storage-metric]');
 if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 event.preventDefault();
 selectStorageMetric(event.key==='Home'?'bytes':event.key==='End'?'files':storageMetric==='bytes'?'files':'bytes');
});
