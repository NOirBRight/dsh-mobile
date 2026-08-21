import type { GatewayEndpoint } from './gateway.ts'

export interface PairingSettingsPageOptions {
  hostIdentity: string
  endpoint: GatewayEndpoint | null
  endpointMode?: 'quick' | 'custom'
  customEndpointUrl?: string
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Self-contained loopback-only Host controls; no runtime CDN or maintainer service. */
export function renderPairingSettingsPage(options: PairingSettingsPageOptions): string {
  const identity = escapeHtml(options.hostIdentity)
  const endpoint = options.endpoint === null ? 'Starting Temporary Endpoint…' : escapeHtml(options.endpoint.url)
  const kind = options.endpoint?.kind === 'custom' ? 'Custom Endpoint' : 'Temporary Endpoint'
  const mode = options.endpointMode === 'custom' ? 'custom' : 'quick'
  const customUrl = escapeHtml(options.customEndpointUrl ?? '')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Mobile Pairing</title><style>
:root{color-scheme:light dark;font:15px/1.45 system-ui,sans-serif}body{max-width:980px;margin:auto;padding:24px}h1{margin:.2em 0}.muted{opacity:.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{border:1px solid #8886;border-radius:12px;padding:16px}code{word-break:break-all}img{box-sizing:border-box;display:block;max-width:320px;width:100%;padding:12px;background:white;margin:12px auto;border-radius:8px}button,a.button{border:1px solid #777;border-radius:8px;padding:8px 12px;background:transparent;color:inherit;text-decoration:none;cursor:pointer}.danger{color:#dc2626}.device{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid #8884}.device span{flex:1;min-width:180px}.hidden{display:none}</style></head><body>
<h1>DSH Mobile</h1>
<p class="muted">Host Identity: <code>${identity}</code>. Pairing offers expire after five minutes and are single-use. Scan this code with the DSH Mobile app. Each device needs a new code; codes rotate after a successful pair and every 20 seconds.</p>
<section class="card" style="margin-top:16px"><h2>Public Endpoint</h2>
<form id="endpoint-form"><label><input type="radio" name="mode" value="quick"${mode === 'quick' ? ' checked' : ''}> Temporary address</label>
<label style="margin-left:12px"><input type="radio" name="mode" value="custom"${mode === 'custom' ? ' checked' : ''}> Custom domain</label>
<p><span id="endpoint-kind">${kind}</span><br><code id="endpoint">${endpoint}</code></p>
<p><input id="custom-url" name="customEndpointUrl" value="${customUrl}" placeholder="https://host.example" style="width:min(100%,480px)"></p>
<button type="submit">Check and save</button> <span id="endpoint-save" class="muted"></span></form>
<p class="muted">Custom Endpoint is checked for HTTPS, Host Identity, protocol 1, capabilities, and /signal/check before it is saved.</p></section>
<section class="card" style="margin-top:16px"><h2>Add a device</h2><img id="qr-shared" alt="Pairing QR" src="/pair?format=svg"><button type="button" id="refresh-qr">New code</button></section>
<section class="card" style="margin-top:16px"><h2>Authorized devices</h2><p class="muted">Rename is Host-side. Update address keeps the selected device authorization. Revocation is Host-side; Profile Removal in the app is local-only.</p><div id="devices">Loading…</div></section>
<section id="refresh" class="card hidden" style="margin-top:16px"><h2>Endpoint Refresh</h2><p id="refresh-label"></p><img id="refresh-qr" alt="Endpoint Refresh QR"><button id="close-refresh">Close</button></section>
<script>
const devices = document.getElementById('devices');
let liveCount=0;
function qrUrl(){return '/pair?format=svg&_='+Date.now()}
function rotateQrs(){const qr=document.getElementById('qr-shared'); if(qr) qr.src=qrUrl()}
document.getElementById('refresh-qr').onclick=rotateQrs;
async function loadDevices(){
  const response=await fetch('/pair/devices',{cache:'no-store'}); const payload=await response.json(); const list=payload.devices; devices.textContent='';
  if(!list.length){devices.textContent='No authorized devices yet.';return}
  const nextLive=list.filter(device=>!device.revokedAt).length;
  if(nextLive>liveCount) rotateQrs();
  liveCount=nextLive;
  for(const device of list){
    const row=document.createElement('div'); row.className='device';
    const label=document.createElement('span');
    const seen=device.lastSeenAt?new Date(device.lastSeenAt).toISOString():'';
    const paired=device.createdAt?new Date(device.createdAt).toISOString():'';
    label.textContent=[device.label||device.id, device.clientType, paired?'paired '+paired:'', seen?'last seen '+seen:'', device.revokedAt?'(revoked)':''].filter(Boolean).join(' · ');
    row.append(label);
    if(!device.revokedAt){
      const rename=document.createElement('button'); rename.textContent='Rename'; rename.onclick=()=>renameDevice(device); row.append(rename);
      const refresh=document.createElement('button'); refresh.textContent='Update address'; refresh.onclick=()=>showRefresh(device); row.append(refresh);
      const revoke=document.createElement('button'); revoke.className='danger'; revoke.textContent='Revoke'; revoke.onclick=()=>revokeDevice(device.id); row.append(revoke);
    }
    devices.append(row);
  }
}
async function renameDevice(device){
  const next=window.prompt('Device name', device.label||device.id);
  if(next===null) return;
  await fetch('/pair/label',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:device.id,label:next})});
  await loadDevices();
}
function showRefresh(device){
  document.getElementById('refresh-label').textContent='Refresh '+(device.label||device.id);
  document.getElementById('refresh-qr').src='/pair?format=svg&room='+encodeURIComponent(device.room)+'&_='+Date.now();
  document.getElementById('refresh').classList.remove('hidden');
}
document.getElementById('close-refresh').onclick=()=>document.getElementById('refresh').classList.add('hidden');
async function revokeDevice(id){if(!confirm('Revoke this device? Its next connection will be rejected.'))return;await fetch('/pair/revoke',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id})});await loadDevices()}
loadDevices().catch(error=>{devices.textContent='Failed to load devices: '+error});
setInterval(()=>{void loadDevices()},5000);
setInterval(rotateQrs,20000);
const saveStatus=document.getElementById('endpoint-save');
document.getElementById('endpoint-form').onsubmit=async event=>{
  event.preventDefault();
  const mode=[...document.querySelectorAll('input[name=mode]')].find(input=>input.checked)?.value||'quick';
  const customEndpointUrl=document.getElementById('custom-url').value.trim();
  saveStatus.textContent='Checking endpoint…';
  const response=await fetch('/pair/endpoint',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(mode==='custom'?{endpointMode:'custom',customEndpointUrl}:{endpointMode:'quick'})});
  const payload=await response.json();
  const stages={endpoint:'URL syntax',tls:'TLS/HTTP reachability',identity:'Host Identity',protocol:'protocol',capabilities:'capabilities',websocket:'WebSocket upgrade'};
  saveStatus.textContent=payload.ok?'Public Endpoint saved.':(stages[payload.stage]||payload.stage||'error')+': '+(payload.error||response.status);
};
setInterval(async()=>{try{const response=await fetch('/pair/status',{cache:'no-store'});const status=await response.json();document.getElementById('endpoint').textContent=status.endpoint?.url||'Starting Temporary Endpoint…';document.getElementById('endpoint-kind').textContent=status.endpoint?.kind==='custom'?'Custom Endpoint':'Temporary Endpoint'}catch{}},5000);
</script></body></html>`
}
