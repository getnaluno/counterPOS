(function(){
"use strict";

/* ================= GLOBAL STATE ================= */
let clientsRegistry = { clients: [] };          // pos-clients (shared)
let devSettings = { devPassword: "dev2026" };    // pos-dev-settings (shared)
let shopData = { products: [], orders: [], invLog: [], staff: [] }; // active shop's blob
let currentClientId = null;

let view = "select";      // select | customer | admin | dev
let adminAuthed = false;
let devAuthed = false;
let adminTab = "overview";
let devTab = "clients";
let categoryFilter = "All";
let invHistoryFilter = "all";
let ready = false;
let shopSelectErr = "";
let devViewedClientId = null;
let devViewedShopData = null;

const LOW_STOCK_THRESHOLD = 5;

/* ================= HELPERS ================= */
function uid(prefix){ return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function money(n){ return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }
function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function fmtDate(d){ const dt = new Date(d); return dt.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) + " " + dt.toLocaleTimeString(undefined,{hour:"2-digit",minute:"2-digit"}); }
function fmtDay(d){ return new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}); }
function isSameDay(a,b){ return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate(); }
function statusOf(p){
  if(p.status === "hidden") return {key:"hidden", label:"Hidden"};
  if(p.stock <= 0) return {key:"out", label:"Out of Stock"};
  if(p.stock <= LOW_STOCK_THRESHOLD) return {key:"low", label:"Low Stock"};
  return {key:"avail", label:"Available"};
}
function toast(msg){
  const root = document.getElementById("toastRoot");
  const el = document.createElement("div");
  el.className = "toast"; el.textContent = msg;
  root.appendChild(el);
  setTimeout(()=>el.remove(), 2400);
}
function addPlanDuration(fromISO, plan){
  const d = new Date(fromISO);
  if(plan === "annual") d.setFullYear(d.getFullYear()+1);
  else d.setMonth(d.getMonth()+1);
  return d.toISOString();
}
function daysLeft(endISO){
  const ms = new Date(endISO) - new Date();
  return Math.ceil(ms / (1000*60*60*24));
}
function genShopCode(){
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do{
    code = "";
    for(let i=0;i<6;i++) code += chars.charAt(Math.floor(Math.random()*chars.length));
  }while(clientsRegistry.clients.some(c=>c.shopCode===code));
  return code;
}
function getCurrentClient(){ return clientsRegistry.clients.find(c=>c.id===currentClientId) || null; }

/* ---- safe storage layer ----
   - shared:false data (e.g. "remember my last shop code on this device") always
     stays in this browser's localStorage — it's personal, not business data.
   - shared:true data uses, in order of preference:
       1) window.CounterStorageProvider, if a backend script (e.g. Firebase) defines one
       2) window.storage, the built-in Claude artifact storage API
       3) localStorage, as a last-resort single-device fallback
   None of these ever throw — every call is safe to await. ---- */
const hasCloudStorage = (typeof window !== "undefined") && window.storage && typeof window.storage.get === "function";
function localGet(key){
  try{ const raw = localStorage.getItem("cpos:"+key); return raw ? { key, value: raw } : null; }catch(e){ return null; }
}
function localSet(key, value){
  try{ localStorage.setItem("cpos:"+key, value); return { key, value }; }catch(e){ return null; }
}
function localDelete(key){
  try{ localStorage.removeItem("cpos:"+key); return { key, deleted:true }; }catch(e){ return null; }
}
function localList(prefix){
  try{
    const keys = [];
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.indexOf("cpos:"+(prefix||"")) === 0) keys.push(k.slice(5));
    }
    return { keys };
  }catch(e){ return { keys: [] }; }
}
async function storageGet(key, shared){
  if(!shared) return localGet(key);
  if(window.CounterStorageProvider){ try{ return await window.CounterStorageProvider.get(key, shared); }catch(e){ return null; } }
  if(hasCloudStorage){ try{ return await window.storage.get(key, shared); }catch(e){ return null; } }
  return localGet(key);
}
async function storageSet(key, value, shared){
  if(!shared) return localSet(key, value);
  if(window.CounterStorageProvider){ try{ return await window.CounterStorageProvider.set(key, value, shared); }catch(e){ return null; } }
  if(hasCloudStorage){ try{ return await window.storage.set(key, value, shared); }catch(e){ return null; } }
  return localSet(key, value);
}
async function storageDelete(key, shared){
  if(!shared) return localDelete(key);
  if(window.CounterStorageProvider){ try{ return await window.CounterStorageProvider.delete(key, shared); }catch(e){ return null; } }
  if(hasCloudStorage){ try{ return await window.storage.delete(key, shared); }catch(e){ return null; } }
  return localDelete(key);
}
async function storageList(prefix, shared){
  if(!shared) return localList(prefix);
  if(window.CounterStorageProvider){ try{ return await window.CounterStorageProvider.list(prefix, shared); }catch(e){ return { keys: [] }; } }
  if(hasCloudStorage){ try{ return await window.storage.list(prefix, shared); }catch(e){ return { keys: [] }; } }
  return localList(prefix);
}
function effectiveStatus(client){
  if(!client) return {key:"missing", label:"Not Found"};
  if(client.status === "suspended") return {key:"suspended", label:"Suspended"};
  if(new Date() > new Date(client.subscriptionEnd)) return {key:"expired", label:"Expired"};
  return {key:"active", label:"Active"};
}

/* ================= STORAGE ================= */
async function loadAll(){
  try{ const r = await storageGet("pos-clients", true); clientsRegistry = r ? JSON.parse(r.value) : null; }catch(e){ clientsRegistry = null; }
  try{ const r = await storageGet("pos-dev-settings", true); devSettings = r ? JSON.parse(r.value) : null; }catch(e){ devSettings = null; }

  if(!clientsRegistry){
    const demoId = uid("cli");
    clientsRegistry = { clients: [{
      id: demoId, businessName: "Demo Pop-Up", shopCode: "DEMO01",
      contactEmail: "owner@example.com", plan: "monthly",
      subscriptionStart: new Date().toISOString(),
      subscriptionEnd: addPlanDuration(new Date().toISOString(), "monthly"),
      status: "active", adminPassword: "admin123", createdDate: new Date().toISOString()
    }]};
    await saveClientsRegistry();
    await storageSet("pos-shop-"+demoId, JSON.stringify({ products: seedProducts(), orders: [], invLog: [], staff: [{id:uid("stf"),name:"Staff One",role:"Staff"}] }), true);
  }
  if(!devSettings){ devSettings = { devPassword: "dev2026" }; await saveDevSettings(); }

  try{
    const r = await storageGet("pos-last-shop", false);
    if(r){ const saved = JSON.parse(r.value); if(saved && saved.code) lastShopCodeHint = saved.code; }
  }catch(e){ /* none saved yet */ }

  ready = true;
}
function seedProducts(){
  const mk = (name,cat,price,stock) => ({ id: uid("prd"), name, category:cat, price, stock, image:"", description:"", status:"available", createdDate: new Date().toISOString() });
  return [
    mk("Cappuccino","Coffee",5,50), mk("Latte","Coffee",6,40), mk("Espresso","Coffee",4,60),
    mk("Iced Tea","Drinks",4,20), mk("Bottled Water","Drinks",2,50),
    mk("Cookie","Snacks",3,30), mk("Croissant","Snacks",4,25),
  ];
}
let lastShopCodeHint = "";
async function saveClientsRegistry(){ try{ await storageSet("pos-clients", JSON.stringify(clientsRegistry), true); }catch(e){ toast("Couldn't save client list — try again"); } }
async function saveDevSettings(){ try{ await storageSet("pos-dev-settings", JSON.stringify(devSettings), true); }catch(e){ toast("Couldn't save developer settings"); } }
async function loadShopData(clientId){
  try{
    const r = await storageGet("pos-shop-"+clientId, true);
    shopData = r ? JSON.parse(r.value) : { products:[], orders:[], invLog:[], staff:[] };
  }catch(e){ shopData = { products:[], orders:[], invLog:[], staff:[] }; }
}
async function saveShopData(){ try{ await storageSet("pos-shop-"+currentClientId, JSON.stringify(shopData), true); }catch(e){ toast("Couldn't save — try again"); } }
async function rememberShopCode(code){ try{ await storageSet("pos-last-shop", JSON.stringify({code}), false); }catch(e){} }

/* ================= RENDER DISPATCH ================= */
function render(){
  renderNav();
  const root = document.getElementById("viewRoot");
  if(!ready){ root.innerHTML = '<div class="loading-screen">Loading…</div>'; return; }

  if(view === "select"){ root.innerHTML = renderShopSelect(); }
  else if(view === "dev"){ root.innerHTML = devAuthed ? renderDev() : renderLogin("dev"); }
  else{
    const client = getCurrentClient();
    if(!client){ view = "select"; root.innerHTML = renderShopSelect(); }
    else{
      const st = effectiveStatus(client);
      if(st.key !== "active"){ root.innerHTML = renderLockScreen(client, st); }
      else if(view === "customer"){ root.innerHTML = renderCustomer(); }
      else if(view === "admin"){ root.innerHTML = adminAuthed ? renderAdmin() : renderLogin("admin"); }
    }
  }
  attachDynamicHandlers();
}
function renderNav(){
  const nav = document.getElementById("navPills");
  const tag = document.getElementById("shopTag");
  const client = getCurrentClient();
  if(client && view !== "select" && view !== "dev"){
    tag.innerHTML = `<span class="shop-tag">${esc(client.businessName)} · ${esc(client.shopCode)}</span>`;
  } else { tag.innerHTML = ""; }

  if(view === "dev"){ nav.innerHTML = ""; return; }
  if(!client){ nav.innerHTML = ""; return; }
  nav.innerHTML = `
    <button class="pill ${view==='customer'?'active':''}" data-nav="customer">Counter</button>
    <button class="pill ${view==='admin'?'active':''}" data-nav="admin">Admin</button>
    <button class="pill subtle" data-action="switch-shop">Switch Shop</button>
  `;
}

/* ================= SHOP SELECT ================= */
function renderShopSelect(){
  return `
  <div class="select-wrap">
    <div class="select-card">
      <h1 class="display" style="font-size:21px;">Enter Shop Code</h1>
      <p>Each pop-up has its own shop code from Counter POS. Enter yours to open the counter or admin dashboard.</p>
      <input class="code-input" id="shopCodeInput" maxlength="8" placeholder="ABC123" value="${esc(lastShopCodeHint)}" autocomplete="off">
      <div class="select-btn-row">
        <button class="btn btn-outline btn-block" data-action="enter-shop" data-target="admin">Open Admin</button>
        <button class="btn btn-primary btn-block" data-action="enter-shop" data-target="customer">Open Counter</button>
      </div>
      <div class="select-err">${esc(shopSelectErr)}</div>
      <div class="select-hint">New pop-up? Ask your Counter POS administrator to create a shop for you. Trying it out? Use code <strong>DEMO01</strong>.</div>
    </div>
  </div>`;
}
async function enterShop(target){
  const raw = document.getElementById("shopCodeInput").value.trim().toUpperCase();
  shopSelectErr = "";
  if(!raw){ shopSelectErr = "Enter a shop code."; render(); return; }
  const client = clientsRegistry.clients.find(c=>c.shopCode === raw);
  if(!client){ shopSelectErr = "No shop found with that code."; render(); return; }
  currentClientId = client.id;
  await loadShopData(client.id);
  await rememberShopCode(raw);
  lastShopCodeHint = raw;
  adminAuthed = false;
  view = target;
  render();
}
function switchShop(){
  currentClientId = null; shopData = { products:[], orders:[], invLog:[], staff:[] };
  adminAuthed = false; view = "select"; shopSelectErr = "";
  render();
}

/* ================= LOCK SCREEN ================= */
function renderLockScreen(client, st){
  const expired = st.key === "expired";
  const heading = expired ? "Subscription Expired" : "Access Suspended";
  const body = expired
    ? `This shop's ${client.plan} plan ended on ${fmtDay(client.subscriptionEnd)}. The counter and admin dashboard are locked until it's approved and renewed by the Counter POS administrator.`
    : `This shop has been temporarily suspended by the Counter POS administrator. Contact them to restore access.`;
  return `
  <div class="lock-wrap">
    <div class="lock-card">
      <div class="lock-icon">🔒</div>
      <h2>${heading}</h2>
      <p>${body}</p>
      <div class="lock-meta">
        ${esc(client.businessName)}<br>Shop Code: ${esc(client.shopCode)}<br>Plan: ${client.plan==='annual'?'Annual':'Monthly'}
      </div>
      <button class="btn btn-outline btn-block" data-action="switch-shop">Switch Shop</button>
    </div>
  </div>`;
}

/* ================= LOGIN ================= */
function renderLogin(kind){
  const title = kind === "admin" ? "Admin Dashboard" : "Developer Panel";
  const sub = kind === "admin" ? "Enter this shop's admin password to manage products, inventory and sales." : "Restricted system panel. Not part of the normal interface.";
  const client = kind === "admin" ? getCurrentClient() : null;
  return `
  <div class="login-wrap">
    <div class="login-card">
      <h2 class="display" style="font-size:20px;">${title}</h2>
      <p>${sub}</p>
      <div class="field">
        <label for="loginPass">Password</label>
        <input type="password" id="loginPass" autocomplete="off" placeholder="••••••••">
      </div>
      <button class="btn btn-primary btn-block" style="margin-top:14px;" data-action="login-${kind}">Sign in</button>
      <div class="login-err" id="loginErr"></div>
      ${kind==='admin' && client ? `<p style="margin-top:16px;font-size:11.5px;color:var(--ink-soft);">Demo password — admin123 (change under Security once inside).</p>` : ""}
      ${kind==='dev' ? `<p style="margin-top:16px;font-size:11.5px;color:var(--ink-soft);">Demo password — dev2026 (change under Security once inside).</p>` : ""}
    </div>
  </div>`;
}
function doLogin(kind){
  const val = document.getElementById("loginPass").value;
  const errEl = document.getElementById("loginErr");
  let expected;
  if(kind === "admin"){ const c = getCurrentClient(); expected = c ? c.adminPassword : null; }
  else expected = devSettings.devPassword;
  if(expected !== null && val === expected){
    if(kind === "admin") adminAuthed = true; else devAuthed = true;
    errEl.textContent = ""; render();
  }else{ errEl.textContent = "Incorrect password. Try again."; }
}

/* ================= CUSTOMER VIEW ================= */
function renderCustomer(){
  const cats = ["All", ...Array.from(new Set(shopData.products.map(p=>p.category).filter(Boolean)))];
  const visible = shopData.products.filter(p => p.status !== "hidden" && (categoryFilter==="All" || p.category===categoryFilter));

  const cards = visible.length ? visible.map(p=>{
    const st = statusOf(p);
    const disabled = st.key === "out";
    const inCart = cart.find(c=>c.productId===p.id);
    return `
    <div class="pcard ${disabled?'disabled':''}">
      <div class="pcard-img">
        ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" onerror="this.parentElement.innerHTML='<div class=&quot;pcard-letter&quot;>${esc(p.name.charAt(0))}</div>'">` : `<div class="pcard-letter">${esc(p.name.charAt(0))}</div>`}
        ${st.key==="low" ? `<span class="badge badge-low">Low Stock</span>` : ""}
        ${st.key==="out" ? `<span class="badge badge-out">Out of Stock</span>` : ""}
      </div>
      <div class="pcard-body">
        <div class="pcard-cat">${esc(p.category||"—")}</div>
        <div class="pcard-name">${esc(p.name)}</div>
        <div class="pcard-foot">
          <div class="pcard-price">${money(p.price)}</div>
          <button class="add-btn" data-action="cart-add" data-id="${p.id}" ${disabled?'disabled':''} aria-label="Add ${esc(p.name)}">${inCart?inCart.qty:'+'}</button>
        </div>
      </div>
    </div>`;
  }).join("") : `<div class="empty-note">No products here yet. Add some from the Admin dashboard → Products.</div>`;

  const ticketRows = cart.length ? cart.map(c=>{
    const p = shopData.products.find(pp=>pp.id===c.productId);
    if(!p) return "";
    return `
    <div class="ticket-row">
      <div><div class="ti-name">${esc(p.name)}</div><div class="ti-line">${money(p.price)} each</div></div>
      <div class="qty-ctl">
        <button class="qty-btn" data-action="cart-dec" data-id="${p.id}">−</button>
        <span>${c.qty}</span>
        <button class="qty-btn" data-action="cart-inc" data-id="${p.id}">+</button>
      </div>
      <div class="ti-amt">${money(p.price*c.qty)}</div>
    </div>`;
  }).join("") : `<div class="ticket-empty">No items yet.<br>Tap a product to add it.</div>`;

  const total = cart.reduce((sum,c)=>{ const p = shopData.products.find(pp=>pp.id===c.productId); return sum + (p?p.price*c.qty:0); },0);
  const itemCount = cart.reduce((n,c)=>n+c.qty,0);

  return `
  <div class="pos-wrap">
    <div class="pos-menu">
      <div class="pos-hero">
        <h1 class="display">Choose Your Order</h1>
        <p>Tap a product to add it to the ticket, then pay at the counter.</p>
      </div>
      <div class="chip-row">${cats.map(c=>`<button class="chip ${categoryFilter===c?'active':''}" data-action="filter-cat" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
      <div class="product-grid">${cards}</div>
    </div>
    <div class="ticket-col">
      <div class="ticket">
        <div class="ticket-head"><h2>Order Ticket</h2><span class="ticket-num">#${String(shopData.orders.length+1).padStart(4,'0')}</span></div>
        <div class="ticket-sub">${new Date().toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'})} · ${itemCount} item${itemCount===1?'':'s'}</div>
        <div class="ticket-items">${ticketRows}</div>
        <div class="ticket-total-row"><span class="ticket-total-label">Total</span><span class="ticket-total-amt">${money(total)}</span></div>
      </div>
      <div class="torn-edge"></div>
      <div class="ticket-pay">
        <button class="btn btn-primary btn-block" data-action="checkout" ${cart.length?'':'disabled'}>Pay ${cart.length?money(total):''}</button>
        ${cart.length ? `<button class="btn btn-ghost btn-block" data-action="cart-clear" style="margin-top:6px;">Clear ticket</button>` : ""}
      </div>
    </div>
  </div>`;
}

let cart = [];
function cartAdd(id){
  const p = shopData.products.find(x=>x.id===id);
  if(!p) return;
  const existing = cart.find(c=>c.productId===id);
  const currentQty = existing ? existing.qty : 0;
  if(currentQty + 1 > p.stock){ toast(`Only ${p.stock} ${p.name} left`); return; }
  if(existing) existing.qty += 1; else cart.push({productId:id, qty:1});
  render();
}
function cartInc(id){ cartAdd(id); }
function cartDec(id){
  const existing = cart.find(c=>c.productId===id);
  if(!existing) return;
  existing.qty -= 1;
  if(existing.qty <= 0) cart = cart.filter(c=>c.productId!==id);
  render();
}
function cartClear(){ cart = []; render(); }

async function checkout(){
  if(!cart.length) return;
  const items = cart.map(c=>{ const p = shopData.products.find(x=>x.id===c.productId); return { productId:p.id, name:p.name, price:p.price, qty:c.qty }; });
  const total = items.reduce((s,i)=>s+i.price*i.qty,0);
  const order = { id: uid("ord"), date: new Date().toISOString(), staff:"Counter Sale", items, total, paymentStatus:"Paid" };
  items.forEach(i=>{
    const p = shopData.products.find(x=>x.id===i.productId);
    if(!p) return;
    const prevStock = p.stock;
    p.stock = Math.max(0, p.stock - i.qty);
    shopData.invLog.push({ id: uid("inv"), date: order.date, productId:p.id, productName:p.name, previousStock:prevStock, newStock:p.stock, changeType:"sale", orderId: order.id });
  });
  shopData.orders.push(order);
  await saveShopData();
  cart = [];
  showReceipt(order);
  render();
}
function showReceipt(order){
  const root = document.getElementById("modalRoot");
  root.innerHTML = `
  <div class="receipt-overlay" data-action="close-receipt">
    <div class="receipt-card" onclick="event.stopPropagation()">
      <div class="receipt-check">✓</div>
      <h3>Sale Complete</h3>
      <div class="rid">Order #${order.id.slice(-6).toUpperCase()} · ${fmtDate(order.date)}</div>
      <div class="receipt-list">${order.items.map(i=>`<div class="receipt-line"><span>${i.qty}× ${esc(i.name)}</span><span>${money(i.price*i.qty)}</span></div>`).join("")}</div>
      <div class="receipt-total"><span>Total</span><span>${money(order.total)}</span></div>
      <button class="btn btn-dark btn-block" style="margin:16px 0 20px;" data-action="close-receipt">New Order</button>
    </div>
  </div>`;
}
function closeReceipt(){ document.getElementById("modalRoot").innerHTML = ""; }

/* ================= ADMIN ================= */
function renderAdmin(){
  const tabs = [["overview","Dashboard"],["products","Products"],["inventory","Inventory"],["sales","Sales"],["users","Users"],["settings","Security"]];
  return `
  <div class="dash">
    <nav class="sidenav">
      ${tabs.map(([k,l])=>`<button class="${adminTab===k?'active':''}" data-action="admin-tab" data-tab="${k}">${l}</button>`).join("")}
      <button style="margin-top:16px;color:var(--red);" data-action="logout-admin">Log out</button>
    </nav>
    <div class="dash-main">${adminTabContent()}</div>
  </div>`;
}
function adminTabContent(){
  if(adminTab==="overview") return adminOverview();
  if(adminTab==="products") return adminProducts();
  if(adminTab==="inventory") return adminInventory();
  if(adminTab==="sales") return adminSales();
  if(adminTab==="users") return adminUsers();
  if(adminTab==="settings") return credentialSettings("admin");
  return "";
}
function ordersOn(dateObj){ return shopData.orders.filter(o=>isSameDay(new Date(o.date), dateObj)); }
function topProductFor(orders){
  const counts = {};
  orders.forEach(o=>o.items.forEach(i=>{ counts[i.name]=(counts[i.name]||0)+i.qty; }));
  const entries = Object.entries(counts);
  if(!entries.length) return "—";
  entries.sort((a,b)=>b[1]-a[1]);
  return entries[0][0];
}
function adminOverview(){
  const today = ordersOn(new Date());
  const todaySales = today.reduce((s,o)=>s+o.total,0);
  const lowStock = shopData.products.filter(p=>p.status!=="hidden" && p.stock>0 && p.stock<=LOW_STOCK_THRESHOLD);
  const outStock = shopData.products.filter(p=>p.stock<=0 && p.status!=="hidden");
  const recent = [...shopData.orders].slice(-6).reverse();
  const client = getCurrentClient();
  return `
  <div class="dash-head"><div><h2>Dashboard</h2><p>Today at a glance · plan ${money0(client)}</p></div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Sales Today</div><div class="stat-val">${money(todaySales)}</div></div>
    <div class="stat-card"><div class="stat-label">Orders Today</div><div class="stat-val">${today.length}</div></div>
    <div class="stat-card"><div class="stat-label">Top Product Today</div><div class="stat-val" style="font-size:17px;">${esc(topProductFor(today))}</div></div>
    <div class="stat-card" style="border-left-color:${outStock.length? 'var(--red)':'var(--sage)'};"><div class="stat-label">Stock Alerts</div><div class="stat-val">${lowStock.length+outStock.length}</div></div>
  </div>
  <div class="section-card">
    <h3>Recent Orders</h3>
    <p class="sc-note">Last ${recent.length} sale${recent.length===1?'':'s'} for this shop.</p>
    ${recent.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Time</th><th>Items</th><th>Total</th></tr></thead><tbody>
      ${recent.map(o=>`<tr><td>#${o.id.slice(-6).toUpperCase()}</td><td>${fmtDate(o.date)}</td><td>${o.items.reduce((n,i)=>n+i.qty,0)}</td><td>${money(o.total)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-note">No sales recorded yet — head to the Counter to ring up an order.</div>`}
  </div>
  ${(lowStock.length||outStock.length) ? `
  <div class="section-card">
    <h3>Inventory Alerts</h3>
    <p class="sc-note">Products at or below the low-stock threshold (${LOW_STOCK_THRESHOLD} units).</p>
    <div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock</th><th>Status</th></tr></thead><tbody>
      ${[...outStock,...lowStock].map(p=>{const st=statusOf(p);return `<tr><td>${esc(p.name)}</td><td>${p.stock}</td><td><span class="badge-tag tag-${st.key}">${st.label}</span></td></tr>`}).join("")}
    </tbody></table></div>
  </div>`: ""}
  `;
}
function money0(client){ return client ? (client.plan==='annual'?'Annual':'Monthly')+', renews '+fmtDay(client.subscriptionEnd) : ''; }

function adminProducts(){
  const rows = shopData.products.map(p=>{
    const st = statusOf(p);
    return `<tr>
      <td><div class="prod-cell"><div class="prod-thumb">${p.image?`<img src="${esc(p.image)}" onerror="this.parentElement.textContent='${esc(p.name.charAt(0))}'">`:esc(p.name.charAt(0))}</div>${esc(p.name)}</div></td>
      <td>${esc(p.category||"—")}</td><td>${money(p.price)}</td><td>${p.stock}</td>
      <td><span class="badge-tag tag-${st.key}">${st.label}</span></td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" data-action="edit-product" data-id="${p.id}">Edit</button>
        <button class="btn btn-danger btn-sm" data-action="delete-product" data-id="${p.id}">Delete</button>
      </td>
    </tr>`;
  }).join("");
  return `
  <div class="dash-head"><div><h2>Products</h2><p>Add, edit and manage what's for sale.</p></div>
    <button class="btn btn-primary" data-action="new-product">+ Add Product</button>
  </div>
  ${shopData.products.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  : `<div class="empty-note">No products yet. Click “Add Product” to create your first item.</div>`}
  `;
}

function adminInventory(){
  const products = shopData.products;
  const log = [...shopData.invLog].filter(l=> invHistoryFilter==="all" || l.productId===invHistoryFilter).reverse().slice(0,60);
  return `
  <div class="dash-head"><div><h2>Inventory</h2><p>Track stock levels and history.</p></div></div>
  <div class="table-wrap" style="margin-bottom:24px;">
    <table><thead><tr><th>Product</th><th>Stock</th><th>Status</th><th>Adjust</th></tr></thead><tbody>
    ${products.map(p=>{ const st=statusOf(p); return `
      <tr>
        <td>${esc(p.name)}</td><td class="mono">${p.stock}</td>
        <td><span class="badge-tag tag-${st.key}">${st.label}</span></td>
        <td class="row-actions">
          <button class="btn btn-outline btn-sm" data-action="stock-adjust" data-id="${p.id}" data-delta="-1">− 1</button>
          <button class="btn btn-outline btn-sm" data-action="stock-adjust" data-id="${p.id}" data-delta="1">+ 1</button>
          <button class="btn btn-outline btn-sm" data-action="stock-set" data-id="${p.id}">Set…</button>
        </td>
      </tr>`;}).join("")}
    </tbody></table>
  </div>
  <div class="section-card">
    <div class="toolbar" style="margin-bottom:10px;">
      <h3 style="margin:0;flex:1;">Stock History</h3>
      <select data-action="filter-inv" id="invFilterSel">
        <option value="all" ${invHistoryFilter==='all'?'selected':''}>All products</option>
        ${products.map(p=>`<option value="${p.id}" ${invHistoryFilter===p.id?'selected':''}>${esc(p.name)}</option>`).join("")}
      </select>
    </div>
    ${log.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Change</th><th>Stock</th><th>Reason</th></tr></thead><tbody>
      ${log.map(l=>`<tr><td>${fmtDate(l.date)}</td><td>${esc(l.productName)}</td><td class="mono">${l.previousStock} → ${l.newStock}</td><td>${l.newStock-l.previousStock>=0?'+':''}${l.newStock-l.previousStock}</td><td>${esc(l.changeType)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-note">No stock movements recorded yet.</div>`}
  </div>
  `;
}

function adminSales(){
  const today = ordersOn(new Date());
  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate()-6); weekAgo.setHours(0,0,0,0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const weekOrders = shopData.orders.filter(o=> new Date(o.date) >= weekAgo);
  const monthOrders = shopData.orders.filter(o=> new Date(o.date) >= monthStart);
  const weekTotal = weekOrders.reduce((s,o)=>s+o.total,0);
  const monthTotal = monthOrders.reduce((s,o)=>s+o.total,0);
  const dayBuckets = [];
  for(let i=6;i>=0;i--){ const d = new Date(); d.setDate(d.getDate()-i); const dOrders = ordersOn(d); dayBuckets.push({ label: d.toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'}), total: dOrders.reduce((s,o)=>s+o.total,0), count: dOrders.length }); }
  const bestCounts = {};
  shopData.orders.forEach(o=>o.items.forEach(i=>{ bestCounts[i.name]=(bestCounts[i.name]||0)+i.qty; }));
  const best = Object.entries(bestCounts).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const allOrders = [...shopData.orders].reverse().slice(0,30);
  return `
  <div class="dash-head"><div><h2>Sales</h2><p>Reports and transaction history.</p></div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Today</div><div class="stat-val">${money(today.reduce((s,o)=>s+o.total,0))}</div></div>
    <div class="stat-card"><div class="stat-label">Last 7 Days</div><div class="stat-val">${money(weekTotal)}</div></div>
    <div class="stat-card"><div class="stat-label">This Month</div><div class="stat-val">${money(monthTotal)}</div></div>
    <div class="stat-card"><div class="stat-label">All-Time Orders</div><div class="stat-val">${shopData.orders.length}</div></div>
  </div>
  <div class="section-card"><h3>Daily Sales — Last 7 Days</h3>
    <div class="table-wrap"><table><thead><tr><th>Day</th><th>Orders</th><th>Sales</th></tr></thead><tbody>
      ${dayBuckets.map(b=>`<tr><td>${b.label}</td><td>${b.count}</td><td>${money(b.total)}</td></tr>`).join("")}
    </tbody></table></div>
  </div>
  <div class="section-card"><h3>Best-Selling Products</h3>
    ${best.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Units Sold</th></tr></thead><tbody>
      ${best.map(([name,qty])=>`<tr><td>${esc(name)}</td><td>${qty}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-note">No sales yet.</div>`}
  </div>
  <div class="section-card"><h3>Transactions</h3>
    ${allOrders.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Date</th><th>Items</th><th>Total</th><th>Status</th></tr></thead><tbody>
      ${allOrders.map(o=>`<tr><td>#${o.id.slice(-6).toUpperCase()}</td><td>${fmtDate(o.date)}</td><td>${o.items.map(i=>`${i.qty}× ${esc(i.name)}`).join(", ")}</td><td>${money(o.total)}</td><td><span class="badge-tag tag-avail">${esc(o.paymentStatus)}</span></td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty-note">No transactions yet.</div>`}
  </div>
  `;
}

function adminUsers(){
  const rows = shopData.staff.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.role)}</td><td class="row-actions"><button class="btn btn-danger btn-sm" data-action="delete-user" data-id="${u.id}">Remove</button></td></tr>`).join("");
  return `
  <div class="dash-head"><div><h2>Users</h2><p>Manage staff accounts and permissions for this shop.</p></div>
    <button class="btn btn-primary" data-action="new-user">+ Add Staff</button>
  </div>
  ${shopData.staff.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  : `<div class="empty-note">No staff added yet.</div>`}
  `;
}

function credentialSettings(kind){
  return `
  <div class="dash-head"><div><h2>Security</h2><p>Manage the password for this panel.</p></div></div>
  <div class="section-card" style="max-width:420px;">
    <h3>Change ${kind==='admin'?'Admin':'Developer'} Password</h3>
    <p class="sc-note">This protects access to the ${kind==='admin'?'Admin Dashboard for this shop':'Developer Panel'}.</p>
    <div class="field" style="margin-bottom:10px;"><label>New password</label><input type="password" id="newPassField" placeholder="Enter a new password"></div>
    <button class="btn btn-dark" data-action="change-pass" data-kind="${kind}">Update Password</button>
  </div>`;
}

/* ---- admin actions ---- */
function openProductModal(id){
  const editing = id ? shopData.products.find(p=>p.id===id) : null;
  document.getElementById("modalRoot").innerHTML = `
  <div class="modal-backdrop" data-action="close-modal">
    <div class="modal" onclick="event.stopPropagation()">
      <h3>${editing?'Edit Product':'Add Product'}</h3>
      <p class="m-note">${editing?'Update the details for this item.':'Fill in the details for the new item.'}</p>
      <div class="field-row">
        <div class="field"><label>Product Name</label><input id="pf-name" value="${editing?esc(editing.name):''}" placeholder="Cappuccino"></div>
        <div class="field"><label>Category</label><input id="pf-cat" value="${editing?esc(editing.category):''}" placeholder="Coffee"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Price</label><input id="pf-price" type="number" step="0.01" min="0" value="${editing?editing.price:''}" placeholder="5.00"></div>
        <div class="field"><label>Stock Quantity</label><input id="pf-stock" type="number" min="0" value="${editing?editing.stock:''}" placeholder="50"></div>
      </div>
      <div class="field" style="margin-bottom:12px;"><label>Image URL (optional)</label><input id="pf-image" value="${editing?esc(editing.image):''}" placeholder="https://…"></div>
      <div class="field" style="margin-bottom:12px;"><label>Description</label><textarea id="pf-desc">${editing?esc(editing.description):''}</textarea></div>
      <div class="field"><label>Status</label>
        <select id="pf-status">
          <option value="available" ${editing&&editing.status==='available'?'selected':''}>Available</option>
          <option value="hidden" ${editing&&editing.status==='hidden'?'selected':''}>Hidden</option>
        </select>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="save-product" data-id="${editing?editing.id:''}">${editing?'Save Changes':'Add Product'}</button>
      </div>
    </div>
  </div>`;
}
async function saveProductFromModal(id){
  const name = document.getElementById("pf-name").value.trim();
  const category = document.getElementById("pf-cat").value.trim();
  const price = parseFloat(document.getElementById("pf-price").value);
  const stock = parseInt(document.getElementById("pf-stock").value,10);
  const image = document.getElementById("pf-image").value.trim();
  const description = document.getElementById("pf-desc").value.trim();
  const status = document.getElementById("pf-status").value;
  if(!name || isNaN(price) || price < 0 || isNaN(stock) || stock < 0){ toast("Please fill in a valid name, price and stock."); return; }
  if(id){ const p = shopData.products.find(x=>x.id===id); Object.assign(p, {name,category,price,stock,image,description,status}); }
  else{ shopData.products.push({ id: uid("prd"), name, category, price, stock, image, description, status, createdDate: new Date().toISOString() }); }
  await saveShopData(); closeModal(); render();
  toast(id?"Product updated":"Product added");
}
function openDeleteConfirm(id){
  const p = shopData.products.find(x=>x.id===id);
  if(!p) return;
  document.getElementById("modalRoot").innerHTML = `
  <div class="modal-backdrop" data-action="close-modal">
    <div class="modal" style="width:380px;" onclick="event.stopPropagation()">
      <h3>Delete “${esc(p.name)}”?</h3>
      <p class="m-note">Are you sure you want to delete this product? This can't be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" style="background:var(--red);color:#fff;border:none;" data-action="confirm-delete-product" data-id="${p.id}">Delete</button>
      </div>
    </div>
  </div>`;
}
async function deleteProduct(id){ shopData.products = shopData.products.filter(p=>p.id!==id); await saveShopData(); closeModal(); render(); toast("Product deleted"); }

function openStockSetModal(id){
  const p = shopData.products.find(x=>x.id===id);
  if(!p) return;
  document.getElementById("modalRoot").innerHTML = `
  <div class="modal-backdrop" data-action="close-modal">
    <div class="modal" style="width:360px;" onclick="event.stopPropagation()">
      <h3>Set Stock — ${esc(p.name)}</h3>
      <p class="m-note">Current stock: ${p.stock}</p>
      <div class="field-row">
        <div class="field"><label>New Stock</label><input id="sf-stock" type="number" min="0" value="${p.stock}"></div>
        <div class="field"><label>Reason</label>
          <select id="sf-reason"><option value="Restock">Restock</option><option value="Correction">Correction</option><option value="Waste">Waste / Spoilage</option></select>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="confirm-stock-set" data-id="${p.id}">Save</button>
      </div>
    </div>
  </div>`;
}
async function confirmStockSet(id){
  const p = shopData.products.find(x=>x.id===id);
  const newStock = parseInt(document.getElementById("sf-stock").value,10);
  const reason = document.getElementById("sf-reason").value;
  if(isNaN(newStock) || newStock < 0){ toast("Enter a valid stock number"); return; }
  const prev = p.stock; p.stock = newStock;
  shopData.invLog.push({ id: uid("inv"), date: new Date().toISOString(), productId:p.id, productName:p.name, previousStock:prev, newStock, changeType:reason });
  await saveShopData(); closeModal(); render(); toast("Stock updated");
}
async function stockAdjust(id, delta){
  const p = shopData.products.find(x=>x.id===id);
  if(!p) return;
  const prev = p.stock; p.stock = Math.max(0, p.stock + delta);
  shopData.invLog.push({ id: uid("inv"), date: new Date().toISOString(), productId:p.id, productName:p.name, previousStock:prev, newStock:p.stock, changeType: delta>0?"Restock":"Correction" });
  await saveShopData(); render();
}
function openUserModal(){
  document.getElementById("modalRoot").innerHTML = `
  <div class="modal-backdrop" data-action="close-modal">
    <div class="modal" style="width:360px;" onclick="event.stopPropagation()">
      <h3>Add Staff</h3>
      <div class="field" style="margin-bottom:12px;"><label>Name</label><input id="uf-name" placeholder="Jordan Lee"></div>
      <div class="field"><label>Role</label><select id="uf-role"><option value="Staff">Staff</option><option value="Admin">Admin</option></select></div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="confirm-add-user">Add Staff</button>
      </div>
    </div>
  </div>`;
}
async function confirmAddUser(){
  const name = document.getElementById("uf-name").value.trim();
  const role = document.getElementById("uf-role").value;
  if(!name){ toast("Enter a name"); return; }
  shopData.staff.push({ id: uid("stf"), name, role });
  await saveShopData(); closeModal(); render(); toast("Staff added");
}
async function deleteUser(id){ shopData.staff = shopData.staff.filter(u=>u.id!==id); await saveShopData(); render(); toast("Staff removed"); }

async function changePassword(kind){
  const val = document.getElementById("newPassField").value;
  if(!val || val.length < 4){ toast("Password should be at least 4 characters"); return; }
  if(kind==='admin'){ const c = getCurrentClient(); c.adminPassword = val; await saveClientsRegistry(); }
  else{ devSettings.devPassword = val; await saveDevSettings(); }
  toast("Password updated"); render();
}
function closeModal(){ document.getElementById("modalRoot").innerHTML = ""; }

/* ================= DEVELOPER PANEL ================= */
function renderDev(){
  const tabs = [["clients","Clients"],["data","Database"],["system","System"],["settings","Security"]];
  return `
  <div class="devshell">
    <div class="dash">
      <nav class="sidenav">
        ${tabs.map(([k,l])=>`<button class="${devTab===k?'active':''}" data-action="dev-tab" data-tab="${k}">${l}</button>`).join("")}
        <button style="margin-top:16px;color:#e88;" data-action="logout-dev">Log out</button>
      </nav>
      <div class="dash-main">${devTabContent()}</div>
    </div>
  </div>`;
}
function devTabContent(){
  if(devTab==="clients") return devClients();
  if(devTab==="data") return devData();
  if(devTab==="system") return devSystem();
  if(devTab==="settings") return credentialSettings("dev");
  return "";
}

function devClients(){
  const clients = clientsRegistry.clients;
  const active = clients.filter(c=>effectiveStatus(c).key==="active").length;
  const expired = clients.filter(c=>effectiveStatus(c).key==="expired").length;
  const suspended = clients.filter(c=>effectiveStatus(c).key==="suspended").length;
  const rows = clients.map(c=>{
    const st = effectiveStatus(c);
    const dleft = daysLeft(c.subscriptionEnd);
    const expiryNote = st.key==="expired" ? `<span style="color:#e88;">expired ${Math.abs(dleft)}d ago</span>` : `${dleft}d left`;
    return `<tr>
      <td><strong>${esc(c.businessName)}</strong><br><span style="color:#9a9a9a;font-size:11.5px;">${esc(c.contactEmail||"—")}</span></td>
      <td class="mono">${esc(c.shopCode)}</td>
      <td>${c.plan==='annual'?'Annual':'Monthly'}</td>
      <td><span class="badge-tag tag-${st.key==='active'?'avail':st.key==='expired'?'out':'susp'}">${st.label}</span></td>
      <td class="mono" style="font-size:11.5px;">${fmtDay(c.subscriptionEnd)}<br>${expiryNote}</td>
      <td class="row-actions">
        <button class="btn btn-dark btn-sm" data-action="renew-client" data-id="${c.id}">Approve &amp; Renew</button>
        <button class="btn btn-outline btn-sm" data-action="toggle-suspend" data-id="${c.id}">${c.status==='suspended'?'Reactivate':'Suspend'}</button>
        <button class="btn btn-outline btn-sm" data-action="edit-client" data-id="${c.id}">Edit</button>
        <button class="btn btn-outline btn-sm" data-action="open-shop-dev" data-id="${c.id}">Open</button>
        <button class="btn btn-danger btn-sm" style="border-color:#e88;color:#e88;" data-action="delete-client" data-id="${c.id}">Delete</button>
      </td>
    </tr>`;
  }).join("");
  return `
  <div class="dash-head"><div><h2 style="color:#fff;">Clients</h2><p style="color:#9a9a9a;">Create and manage every pop-up business using this system.</p></div>
    <button class="btn btn-primary" data-action="new-client">+ New Client</button>
  </div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Total Clients</div><div class="stat-val" style="color:#fff;">${clients.length}</div></div>
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Active</div><div class="stat-val" style="color:#fff;">${active}</div></div>
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Expired / Locked</div><div class="stat-val" style="color:#fff;">${expired}</div></div>
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Suspended</div><div class="stat-val" style="color:#fff;">${suspended}</div></div>
  </div>
  ${clients.length ? `<div class="table-wrap"><table><thead><tr><th>Business</th><th>Code</th><th>Plan</th><th>Status</th><th>Expires</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`
  : `<div class="empty-note">No clients yet. Click “New Client” to onboard your first pop-up.</div>`}
  `;
}
function openClientModal(id){
  const editing = id ? clientsRegistry.clients.find(c=>c.id===id) : null;
  document.getElementById("modalRoot").innerHTML = `
  <div class="modal-backdrop" data-action="close-modal">
    <div class="modal" onclick="event.stopPropagation()">
      <h3>${editing?'Edit Client':'New Client'}</h3>
      <p class="m-note">${editing?'Update this business\u2019s details.':'Create a shop account for a new pop-up business.'}</p>
      <div class="field" style="margin-bottom:12px;"><label>Business Name</label><input id="cf-name" value="${editing?esc(editing.businessName):''}" placeholder="Sunset Coffee Cart"></div>
      <div class="field" style="margin-bottom:12px;"><label>Contact Email / Phone</label><input id="cf-contact" value="${editing?esc(editing.contactEmail):''}" placeholder="owner@example.com"></div>
      <div class="field-row">
        <div class="field"><label>Shop Code</label><input id="cf-code" value="${editing?esc(editing.shopCode):genShopCode()}" style="text-transform:uppercase;"></div>
        <div class="field"><label>Plan</label>
          <select id="cf-plan"><option value="monthly" ${editing&&editing.plan==='monthly'?'selected':''}>Monthly</option><option value="annual" ${editing&&editing.plan==='annual'?'selected':''}>Annual</option></select>
        </div>
      </div>
      <div class="field"><label>Admin Password ${editing?'(leave as-is or change)':''}</label><input id="cf-pass" value="${editing?esc(editing.adminPassword):'admin123'}"></div>
      <div class="field-note">The business will use this password to log into their Admin Dashboard.</div>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-primary" data-action="save-client" data-id="${editing?editing.id:''}">${editing?'Save Changes':'Create Client'}</button>
      </div>
    </div>
  </div>`;
}
async function saveClientFromModal(id){
  const businessName = document.getElementById("cf-name").value.trim();
  const contactEmail = document.getElementById("cf-contact").value.trim();
  const shopCode = document.getElementById("cf-code").value.trim().toUpperCase();
  const plan = document.getElementById("cf-plan").value;
  const adminPassword = document.getElementById("cf-pass").value.trim();
  if(!businessName || !shopCode || adminPassword.length < 4){ toast("Fill in business name, shop code, and a password of 4+ characters."); return; }
  const codeTaken = clientsRegistry.clients.some(c=>c.shopCode===shopCode && c.id!==id);
  if(codeTaken){ toast("That shop code is already in use — choose another."); return; }

  if(id){
    const c = clientsRegistry.clients.find(x=>x.id===id);
    Object.assign(c, { businessName, contactEmail, shopCode, plan, adminPassword });
    await saveClientsRegistry();
    toast("Client updated");
  }else{
    const newId = uid("cli");
    const now = new Date().toISOString();
    clientsRegistry.clients.push({ id:newId, businessName, contactEmail, shopCode, plan, adminPassword, subscriptionStart: now, subscriptionEnd: addPlanDuration(now, plan), status:"active", createdDate: now });
    await saveClientsRegistry();
    await storageSet("pos-shop-"+newId, JSON.stringify({ products:[], orders:[], invLog:[], staff:[] }), true);
    toast("Client created — shop code " + shopCode);
  }
  closeModal(); render();
}
async function renewClient(id){
  const c = clientsRegistry.clients.find(x=>x.id===id);
  if(!c) return;
  const base = new Date() > new Date(c.subscriptionEnd) ? new Date().toISOString() : c.subscriptionEnd;
  c.subscriptionEnd = addPlanDuration(base, c.plan);
  c.status = "active";
  await saveClientsRegistry(); render();
  toast(`Approved — active until ${fmtDay(c.subscriptionEnd)}`);
}
async function toggleSuspend(id){
  const c = clientsRegistry.clients.find(x=>x.id===id);
  if(!c) return;
  c.status = c.status === "suspended" ? "active" : "suspended";
  await saveClientsRegistry(); render();
  toast(c.status === "suspended" ? "Client suspended" : "Client reactivated");
}
function openDeleteClientConfirm(id){
  const c = clientsRegistry.clients.find(x=>x.id===id);
  if(!c) return;
  document.getElementById("modalRoot").innerHTML = `
  <div class="modal-backdrop" data-action="close-modal">
    <div class="modal" style="width:400px;" onclick="event.stopPropagation()">
      <h3>Delete “${esc(c.businessName)}”?</h3>
      <p class="m-note">This permanently removes the client and all of their products, orders and inventory history. This can't be undone.</p>
      <div class="modal-actions">
        <button class="btn btn-outline" data-action="close-modal">Cancel</button>
        <button class="btn btn-danger" style="background:var(--red);color:#fff;border:none;" data-action="confirm-delete-client" data-id="${c.id}">Delete Client</button>
      </div>
    </div>
  </div>`;
}
async function confirmDeleteClient(id){
  clientsRegistry.clients = clientsRegistry.clients.filter(c=>c.id!==id);
  await saveClientsRegistry();
  try{ await storageDelete("pos-shop-"+id, true); }catch(e){}
  if(currentClientId === id){ currentClientId = null; view = "select"; }
  closeModal(); render(); toast("Client deleted");
}
async function openShopAsDev(id){
  currentClientId = id;
  await loadShopData(id);
  adminAuthed = false;
  view = "customer";
  render();
}

function devData(){
  const options = clientsRegistry.clients.map(c=>`<option value="${c.id}" ${devViewedClientId===c.id?'selected':''}>${esc(c.businessName)} (${esc(c.shopCode)})</option>`).join("");
  return `
  <div class="dash-head"><div><h2 style="color:#fff;">Database Control</h2><p style="color:#9a9a9a;">Raw view of stored data.</p></div>
    <button class="btn btn-dark" data-action="dev-export">Export All (.json)</button>
  </div>
  <div class="section-card"><h3 style="color:#fff;">Clients (${clientsRegistry.clients.length})</h3><pre class="rawjson">${esc(JSON.stringify(clientsRegistry.clients,null,2))}</pre></div>
  <div class="section-card">
    <h3 style="color:#fff;">Inspect a Shop's Data</h3>
    <div class="field" style="max-width:340px;margin-bottom:14px;">
      <select id="devShopSel" data-action-select="dev-view-shop">
        <option value="">Select a client…</option>
        ${options}
      </select>
    </div>
    ${devViewedShopData ? `<pre class="rawjson">${esc(JSON.stringify(devViewedShopData,null,2))}</pre>` : `<p class="sc-note" style="color:#9a9a9a;">Choose a client above to view their products, orders, inventory history and staff.</p>`}
  </div>`;
}
async function devViewShop(id){
  devViewedClientId = id || null;
  if(!id){ devViewedShopData = null; render(); return; }
  try{ const r = await storageGet("pos-shop-"+id, true); devViewedShopData = r ? JSON.parse(r.value) : null; }catch(e){ devViewedShopData = null; }
  render();
}

function devSystem(){
  return `
  <div class="dash-head"><div><h2 style="color:#fff;">System Health</h2><p style="color:#9a9a9a;">Live counts across the whole system.</p></div></div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Clients</div><div class="stat-val" style="color:#fff;">${clientsRegistry.clients.length}</div></div>
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Active Shops</div><div class="stat-val" style="color:#fff;">${clientsRegistry.clients.filter(c=>effectiveStatus(c).key==='active').length}</div></div>
    <div class="stat-card"><div class="stat-label" style="color:#9a9a9a;">Locked / Expired</div><div class="stat-val" style="color:#fff;">${clientsRegistry.clients.filter(c=>effectiveStatus(c).key!=='active').length}</div></div>
  </div>
  <div class="section-card">
    <h3 style="color:#fff;">Reset ALL Data</h3>
    <p class="sc-note" style="color:#9a9a9a;">Deletes every client and their shop data, then reseeds the demo shop only. This cannot be undone.</p>
    <button class="btn btn-danger" style="border-color:#e88;color:#e88;" data-action="dev-reset-all">Reset Entire System</button>
  </div>`;
}
async function devExport(){
  const shops = {};
  for(const c of clientsRegistry.clients){
    try{ const r = await storageGet("pos-shop-"+c.id, true); shops[c.shopCode] = r ? JSON.parse(r.value) : null; }catch(e){ shops[c.shopCode] = null; }
  }
  const payload = { clients: clientsRegistry.clients, shops, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload,null,2)], {type:"application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "counter-pos-export.json";
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  toast("Export downloaded");
}
async function devResetAll(){
  try{
    const list = await storageList("pos-shop-", true);
    if(list && list.keys){ for(const k of list.keys){ try{ await storageDelete(k, true); }catch(e){} } }
  }catch(e){}
  const demoId = uid("cli");
  clientsRegistry = { clients: [{ id: demoId, businessName:"Demo Pop-Up", shopCode:"DEMO01", contactEmail:"owner@example.com", plan:"monthly", subscriptionStart:new Date().toISOString(), subscriptionEnd: addPlanDuration(new Date().toISOString(),"monthly"), status:"active", adminPassword:"admin123", createdDate:new Date().toISOString() }] };
  await saveClientsRegistry();
  await storageSet("pos-shop-"+demoId, JSON.stringify({ products: seedProducts(), orders: [], invLog: [], staff: [{id:uid("stf"),name:"Staff One",role:"Staff"}] }), true);
  currentClientId = null; view = "select"; devViewedClientId = null; devViewedShopData = null;
  render(); toast("System reset — demo shop restored");
}

/* ================= EVENT WIRING ================= */
function attachDynamicHandlers(){
  const invSel = document.getElementById("invFilterSel");
  if(invSel) invSel.addEventListener("change", e=>{ invHistoryFilter = e.target.value; render(); });
  const devShopSel = document.getElementById("devShopSel");
  if(devShopSel) devShopSel.addEventListener("change", e=>{ devViewShop(e.target.value); });
}

document.addEventListener("click", async (e)=>{
  const navBtn = e.target.closest("[data-nav]");
  if(navBtn){ view = navBtn.dataset.nav; render(); return; }

  const el = e.target.closest("[data-action]");
  if(!el) return;
  const action = el.dataset.action;
  const id = el.dataset.id;

  try{
    switch(action){
      case "filter-cat": categoryFilter = el.dataset.cat; render(); break;
      case "cart-add": cartAdd(id); break;
      case "cart-inc": cartInc(id); break;
      case "cart-dec": cartDec(id); break;
      case "cart-clear": cartClear(); break;
      case "checkout": await checkout(); break;
      case "close-receipt": closeReceipt(); break;

      case "enter-shop": await enterShop(el.dataset.target); break;
      case "switch-shop": switchShop(); break;

      case "login-admin": doLogin("admin"); break;
      case "login-dev": doLogin("dev"); break;
      case "logout-admin": adminAuthed = false; view = "customer"; render(); break;
      case "logout-dev": devAuthed = false; view = "select"; render(); break;

      case "admin-tab": adminTab = el.dataset.tab; render(); break;
      case "dev-tab": devTab = el.dataset.tab; render(); break;

      case "new-product": openProductModal(null); break;
      case "edit-product": openProductModal(id); break;
      case "save-product": await saveProductFromModal(id||null); break;
      case "delete-product": openDeleteConfirm(id); break;
      case "confirm-delete-product": await deleteProduct(id); break;

      case "stock-adjust": await stockAdjust(id, parseInt(el.dataset.delta,10)); break;
      case "stock-set": openStockSetModal(id); break;
      case "confirm-stock-set": await confirmStockSet(id); break;

      case "new-user": openUserModal(); break;
      case "confirm-add-user": await confirmAddUser(); break;
      case "delete-user": await deleteUser(id); break;

      case "change-pass": await changePassword(el.dataset.kind); break;
      case "close-modal": closeModal(); break;

      case "new-client": openClientModal(null); break;
      case "edit-client": openClientModal(id); break;
      case "save-client": await saveClientFromModal(id||null); break;
      case "renew-client": await renewClient(id); break;
      case "toggle-suspend": await toggleSuspend(id); break;
      case "delete-client": openDeleteClientConfirm(id); break;
      case "confirm-delete-client": await confirmDeleteClient(id); break;
      case "open-shop-dev": await openShopAsDev(id); break;

      case "dev-export": await devExport(); break;
      case "dev-reset-all": if(confirm("Reset the ENTIRE system? All clients and shop data will be deleted. This cannot be undone.")) await devResetAll(); break;
    }
  }catch(err){
    console.error("Action failed:", action, err);
    toast("Something went wrong completing that — please try again.");
  }
});

document.getElementById("devDot").addEventListener("click", ()=>{ view = "dev"; render(); });

document.addEventListener("keydown", (e)=>{
  if(e.key === "Enter"){
    const pass = document.getElementById("loginPass");
    if(pass && document.activeElement === pass){ if(view === "admin") doLogin("admin"); if(view === "dev") doLogin("dev"); }
    const code = document.getElementById("shopCodeInput");
    if(code && document.activeElement === code){ enterShop("customer"); }
  }
});

/* ---------------- init ---------------- */
loadAll().then(render).catch(function(err){
  console.error("Counter POS failed to load cleanly:", err);
  ready = true;
  render();
  toast("Started with limited storage — some changes may not be saved.");
});

})();
