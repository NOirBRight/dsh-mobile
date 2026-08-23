import type { GatewayEndpoint } from './gateway.ts'

export interface PairingSettingsPageOptions {
  hostIdentity: string
  endpoint: GatewayEndpoint | null
  endpointMode?: 'quick' | 'custom' | 'relay'
  endpointState?: 'loading' | 'ready' | 'error'
  endpointError?: string | null
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
  const kind = options.endpoint === null ? 'Not ready' : options.endpoint.kind === 'temporary' ? 'Generated automatically' : 'Entered address'
  const mode = options.endpointMode === 'relay' ? 'relay' : 'quick'
  const relayUrl = escapeHtml(options.relayUrl ?? '')
  const qrReady = options.endpoint !== null && options.endpointState !== 'error'
  const addressLoading = mode === 'quick' && !qrReady && options.endpointState !== 'error'
  const qrMarkup = qrReady
    ? '<div id="qr-shell" class="qr-shell" data-state="loading"><img id="qr-shared" alt="Pairing QR" src="/pair?format=svg"><div class="qr-feedback qr-loading"><i></i><small>Generating code…</small></div><div class="qr-feedback qr-error"><span>QR</span><small>Could not generate the code</small><button type="button" id="retry-qr">Try again</button></div></div>'
    : addressLoading
      ? '<div id="qr-placeholder" class="qr-placeholder" role="status"><i></i><small>Generating address and code…</small></div>'
      : '<div id="qr-placeholder" class="qr-placeholder" role="img" aria-label="Pairing QR not ready"><span>QR</span><small>' + (options.endpointState === 'error' ? 'Could not generate the address. Try again.' : 'Enter an address first') + '</small></div>'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH Mobile Pairing</title><style>
:root{color-scheme:light dark;font:15px/1.45 system-ui,sans-serif}body{max-width:980px;margin:auto;padding:24px}h1{margin:.2em 0}.muted{opacity:.7}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px}.card{border:1px solid #8886;border-radius:12px;padding:16px}code{word-break:break-all}img{box-sizing:border-box;display:block;max-width:320px;width:100%;padding:12px;background:white;margin:auto;border-radius:8px}button,a.button{min-height:38px;border:1px solid #777;border-radius:8px;padding:8px 12px;background:transparent;color:inherit;font:inherit;text-decoration:none;cursor:pointer}.mode-options{display:flex;gap:8px;flex-wrap:wrap}.mode-options label{min-height:40px;display:inline-flex;align-items:center;gap:7px;box-sizing:border-box;padding:7px 10px;border:1px solid #8886;border-radius:8px;cursor:pointer}.mode-options input{width:18px;height:18px;margin:0;accent-color:Highlight}.mode-options label:focus-within{outline:2px solid Highlight;outline-offset:2px}input[type=url]{box-sizing:border-box;width:min(100%,480px);min-height:40px;border:1px solid #777;border-radius:8px;padding:8px 12px;background:transparent;color:inherit;font:inherit}.danger{color:#dc2626}.device{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-top:1px solid #8884}.device span{flex:1;min-width:180px}.qr-shell,.qr-placeholder{box-sizing:border-box;width:320px;max-width:100%;aspect-ratio:1;display:grid;place-items:center;margin:12px auto;border-radius:8px;overflow:hidden}.qr-shell>*{grid-area:1/1}.qr-feedback,.qr-placeholder{align-content:center;gap:8px;color:#888;text-align:center}.qr-feedback{display:none}.qr-shell[data-state=loading] .qr-loading,.qr-shell[data-state=error] .qr-error{display:grid}.qr-shell[data-state=loading] img,.qr-shell[data-state=error] img{visibility:hidden}.qr-placeholder{border:1px dashed #8888;background:repeating-linear-gradient(45deg,#8881 0 2px,transparent 2px 8px)}.qr-placeholder span,.qr-error span{font-size:36px;font-weight:700;letter-spacing:.12em}.qr-placeholder small,.qr-feedback small{font-size:12px}.qr-placeholder i,.qr-loading i{width:28px;height:28px;box-sizing:border-box;border:3px solid #8886;border-top-color:currentColor;border-radius:50%;animation:qr-spin .8s linear infinite}@keyframes qr-spin{to{transform:rotate(360deg)}}.hidden{display:none}</style></head><body>
<h1>DSH Mobile</h1>
<p class="muted">Host Identity: <code>${identity}</code>. Pairing offers expire after five minutes and are single-use. Scan this code with the DSH Mobile app. Each device needs a new code; codes rotate after a successful pair and every 20 seconds.</p>
<section class="card" style="margin-top:16px"><h2>Connection method</h2>
<form id="endpoint-form"><div class="mode-options"><label><input type="radio" name="mode" value="quick"${mode === 'quick' ? ' checked' : ''}> Generate automatically</label>
<label><input type="radio" name="mode" value="relay"${mode === 'relay' ? ' checked' : ''}> Enter an address</label></div>
<h3>Connection address</h3>
<div id="quick-address" class="${mode === 'quick' ? '' : 'hidden'}"><span id="endpoint-kind">${kind}</span><br><code id="endpoint">${endpoint}</code><p class="muted">The address and code are generated together.</p></div>
<div id="relay-picker" class="${mode === 'relay' ? '' : 'hidden'}"><label for="relay-url" class="muted">Connection address</label><p><input id="relay-url" name="relayUrl" type="url" inputmode="url" autocomplete="off" placeholder="wss://your-service.example" value="${relayUrl}"> <button type="submit">Generate code</button></p><p class="muted"><a href="https://github.com/NOirBRight/dsh-mobile/tree/master/relay/deploy">How to deploy your own connection service</a></p></div>
<span id="endpoint-save" class="muted"></span></form>
<h2>Add a device</h2>${qrMarkup}</section>
<section class="card" style="margin-top:16px"><h2>Authorized devices</h2><p class="muted">Rename is Host-side. Update address keeps the selected device authorization. Revocation is Host-side; Profile Removal in the app is local-only.</p><div id="devices">Loading…</div></section>
<section id="refresh" class="card hidden" style="margin-top:16px"><h2>Endpoint Refresh</h2><p id="refresh-label"></p><img id="refresh-qr-image" alt="Endpoint Refresh QR"><button id="close-refresh">Close</button></section>
<script>
const devices = document.getElementById('devices');
let liveCount=0;
function qrUrl(){return '/pair?format=svg&_='+Date.now()}
function wireQr(qr){const shell=document.getElementById('qr-shell');if(!shell)return;shell.dataset.state='loading';qr.onload=()=>{shell.dataset.state='ready'};qr.onerror=()=>{shell.dataset.state='error'};if(qr.complete)shell.dataset.state=qr.naturalWidth>0?'ready':'error'}
function rotateQrs(){const qr=document.getElementById('qr-shared');const shell=document.getElementById('qr-shell');if(qr){if(shell)shell.dataset.state='loading';qr.src=qrUrl()}}
function activateQr(){let qr=document.getElementById('qr-shared');if(qr){rotateQrs();return}const placeholder=document.getElementById('qr-placeholder');if(!placeholder)return;const shell=document.createElement('div');shell.id='qr-shell';shell.className='qr-shell';shell.dataset.state='loading';shell.innerHTML='<img id="qr-shared" alt="Pairing QR"><div class="qr-feedback qr-loading"><i></i><small>Generating code…</small></div><div class="qr-feedback qr-error"><span>QR</span><small>Could not generate the code</small><button type="button" id="retry-qr">Try again</button></div>';placeholder.replaceWith(shell);qr=document.getElementById('qr-shared');wireQr(qr);document.getElementById('retry-qr').onclick=rotateQrs;rotateQrs()}
function showAddressFailure(){const placeholder=document.getElementById('qr-placeholder');if(!placeholder)return;placeholder.replaceChildren();placeholder.removeAttribute('role');placeholder.setAttribute('role','alert');const mark=document.createElement('span');mark.textContent='QR';const message=document.createElement('small');message.textContent='Could not generate the address. Try again.';placeholder.append(mark,message)}
const initialQr=document.getElementById('qr-shared');if(initialQr)wireQr(initialQr);const retryQr=document.getElementById('retry-qr');if(retryQr)retryQr.onclick=rotateQrs;
const relayPicker=document.getElementById('relay-picker');const quickAddress=document.getElementById('quick-address');function updateMode(){const selected=[...document.querySelectorAll('input[name=mode]')].find(input=>input.checked)?.value;relayPicker.classList.toggle('hidden',selected!=='relay');quickAddress.classList.toggle('hidden',selected!=='quick')}document.querySelectorAll('input[name=mode]').forEach(input=>input.onchange=()=>{updateMode();if(input.checked&&input.value==='quick')document.getElementById('endpoint-form').requestSubmit()});updateMode();
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
  saveStatus.textContent=payload.ok?'Connection saved. Generating code…':(stages[payload.stage]||payload.stage||'error')+': '+(payload.error||response.status);
  if(payload.ok&&payload.endpoint)setTimeout(activateQr,250);
};
setInterval(async()=>{try{const response=await fetch('/pair/status',{cache:'no-store'});const status=await response.json();document.getElementById('endpoint').textContent=status.endpoint?.url||'Not ready';document.getElementById('endpoint-kind').textContent=status.endpoint?.kind==='temporary'?'Generated automatically':status.endpoint?'Entered address':'Not ready';if(status.endpoint&&!document.getElementById('qr-shared'))activateQr();else if(status.endpointState==='error')showAddressFailure()}catch{}},5000);
</script></body></html>`
}
