import type { GatewayEndpoint } from './gateway.ts'

export interface PairingSettingsPageOptions {
  hostIdentity: string
  endpoint: GatewayEndpoint | null
  endpointMode?: 'quick' | 'custom' | 'relay'
  customEndpointUrl?: string
  relayUrl?: string
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** Self-contained loopback-only Host controls; no runtime CDN or maintainer service. */
export function renderPairingSettingsPage(options: PairingSettingsPageOptions): string {
  const identity = escapeHtml(options.hostIdentity)
  const endpoint = options.endpoint === null ? '' : escapeHtml(options.endpoint.url)
  const kind = options.endpoint?.kind === 'relay' ? 'Relay' : options.endpoint?.kind === 'custom' ? 'Saved Endpoint' : options.endpoint === null ? 'Not configured' : 'Temporary Endpoint'
  const mode = options.endpointMode === 'relay' ? 'relay' : 'quick'
  const relayUrl = escapeHtml(options.relayUrl ?? '')
  const qrReady = options.endpoint !== null && ((mode === 'quick' && options.endpoint.kind === 'temporary') || (mode === 'relay' && options.endpoint.kind === 'relay'))
  const qrMarkup = qrReady ? '<img id="qr-shared" alt="Pairing QR" src="/pair?format=svg">' : '<div id="qr-placeholder" class="qr-placeholder" role="img" aria-label="Pairing QR not ready"><span>QR</span><small>Set and save an endpoint first</small></div>'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Mobile Pairing</title><style>
:root{color-scheme:light dark;font:15px/1.45 system-ui,sans-serif}body{max-width:980px;margin:auto;padding:24px}h1{margin:.2em 0}.muted{opacity:.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{border:1px solid #8886;border-radius:12px;padding:16px}code{word-break:break-all}img{box-sizing:border-box;display:block;max-width:320px;width:100%;padding:12px;background:white;margin:12px auto;border-radius:8px}button,a.button{border:1px solid #777;border-radius:8px;padding:8px 12px;background:transparent;color:inherit;text-decoration:none;cursor:pointer}.danger{color:#dc2626}.device{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid #8884}.device span{flex:1;min-width:180px}.qr-placeholder{box-sizing:border-box;width:320px;height:240px;display:grid;place-content:center;gap:8px;border:1px dashed #8888;border-radius:8px;background:repeating-linear-gradient(45deg,#8881 0 2px,transparent 2px 8px);color:#888;text-align:center}.qr-placeholder span{font-size:36px;font-weight:700;letter-spacing:.12em}.qr-placeholder small{font-size:12px}.hidden{display:none}</style></head><body>
<h1>DSH Mobile</h1>
<p class="muted">Host Identity: <code>${identity}</code>. Pairing offers expire after five minutes and are single-use. Scan this code with the DSH Mobile app. Each device needs a new code; codes rotate after a successful pair and every 20 seconds.</p>
<section class="card" style="margin-top:16px"><h2>Public Endpoint</h2>
<form id="endpoint-form"><label><input type="radio" name="mode" value="quick"${mode === 'quick' ? ' checked' : ''}> Temporary address</label>
<label style="margin-left:12px"><input type="radio" name="mode" value="relay"${mode === 'relay' ? ' checked' : ''}> Relay</label>
<p><span id="endpoint-kind">${kind}</span><br><code id="endpoint">${endpoint}</code></p>
<p id="relay-picker" class="${mode === 'relay' ? '' : 'hidden'}"><select id="relay-url" name="relayUrl" value="${relayUrl}" style="width:min(100%,480px)"><option value="wss://relay.noirbright.top"${relayUrl === 'wss://relay.noirbright.top' ? ' selected' : ''}>Domestic Relay</option><option value="wss://relay-overseas.noirbright.top"${relayUrl === 'wss://relay-overseas.noirbright.top' ? ' selected' : ''}>Overseas Relay</option>${relayUrl !== '' && relayUrl !== 'wss://relay.noirbright.top' && relayUrl !== 'wss://relay-overseas.noirbright.top' ? '<option value="' + relayUrl + '" selected>' + relayUrl + '</option>' : ''}</select></p>
<button type="submit">Check and save</button> <span id="endpoint-save" class="muted"></span></form>
<p class="muted">Relay is checked through its health endpoint. Self-host Docker from <a href="https://github.com/NOirBRight/dsh-mobile/tree/master/relay/deploy">GitHub</a>.</p></section>
<section class="card" style="margin-top:16px"><h2>Add a device</h2>${qrMarkup}<button type="button" id="refresh-qr-button"${qrReady ? '' : ' disabled'}>New code</button></section>
<section class="card" style="margin-top:16px"><h2>Authorized devices</h2><p class="muted">Rename is Host-side. Update address keeps the selected device authorization. Revocation is Host-side; Profile Removal in the app is local-only.</p><div id="devices">Loading…</div></section>
<section id="refresh" class="card hidden" style="margin-top:16px"><h2>Endpoint Refresh</h2><p id="refresh-label"></p><img id="refresh-qr-image" alt="Endpoint Refresh QR"><button id="close-refresh">Close</button></section>
<script>
const devices = document.getElementById('devices');
let liveCount=0;
function qrUrl(){return '/pair?format=svg&_='+Date.now()}
function rotateQrs(){const qr=document.getElementById('qr-shared'); if(qr) qr.src=qrUrl()}
document.getElementById('refresh-qr-button').onclick=rotateQrs;
const relayPicker=document.getElementById('relay-picker');function updateMode(){const selected=[...document.querySelectorAll('input[name=mode]')].find(input=>input.checked)?.value;relayPicker.classList.toggle('hidden',selected!=='relay')}document.querySelectorAll('input[name=mode]').forEach(input=>input.onchange=updateMode);updateMode();
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
  document.getElementById('refresh-qr-image').src='/pair?format=svg&room='+encodeURIComponent(device.room)+'&_='+Date.now();
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
  const relayUrl=document.getElementById('relay-url').value.trim();
  saveStatus.textContent='Checking endpoint…';
  const body=mode==='relay'?{endpointMode:'relay',relayUrl}:{endpointMode:'quick'};
  const response=await fetch('/pair/endpoint',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const payload=await response.json();
  const stages={endpoint:'URL syntax',tls:'TLS/HTTP reachability',identity:'Host Identity',protocol:'protocol',capabilities:'capabilities',websocket:'WebSocket upgrade',relay:'Relay health'};
  saveStatus.textContent=payload.ok?'Public Endpoint saved.':(stages[payload.stage]||payload.stage||'error')+': '+(payload.error||response.status);
  if(payload.ok) setTimeout(()=>{ const placeholder=document.getElementById('qr-placeholder'); if(placeholder){ const image=document.createElement('img'); image.id='qr-shared'; image.alt='Pairing QR'; image.src='/pair?format=svg&_='+Date.now(); placeholder.replaceWith(image); } const button=document.getElementById('refresh-qr-button'); if(button) button.disabled=false; },250);
};
setInterval(async()=>{try{const response=await fetch('/pair/status',{cache:'no-store'});const status=await response.json();document.getElementById('endpoint').textContent=status.endpoint?.url||'Not configured';document.getElementById('endpoint-kind').textContent=status.endpoint?.kind==='relay'?'Relay':status.endpoint?.kind==='custom'?'Saved Endpoint':status.endpoint?.kind==='temporary'?'Temporary Endpoint':'Not configured'}catch{}},5000);
</script></body></html>`
}
