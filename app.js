(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const now = () => Date.now();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const STORE_KEY = 'gscnet-state-v1';
  const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt'];
  const icons = {home:'⌂', explore:'⌕', reels:'▶', messages:'✦', notifications:'♡', profile:'◎', saved:'◇', settings:'⚙'};
  const nav = [
    ['home', 'Home'], ['explore', 'Explore'], ['reels', 'Reels'], ['messages', 'Messages'],
    ['notifications', 'Activity'], ['profile', 'Profile'], ['saved', 'Saved'], ['settings', 'Settings']
  ];
  const mobileViews = ['home', 'explore', 'create', 'reels', 'profile'];
  const gradients = [
    'linear-gradient(140deg,#783cff,#0fc7ef)', 'linear-gradient(140deg,#ff557a,#8049ff)',
    'linear-gradient(140deg,#00a884,#0b5dd8)', 'linear-gradient(140deg,#ff9348,#ec3f87)',
    'linear-gradient(140deg,#275efe,#12d8c7)', 'linear-gradient(140deg,#c43cec,#f06a55)'
  ];

  const defaultState = () => ({
    version: 1, profile: null, community: null, profiles: [], posts: [], stories: [],
    messages: {}, follows: [], saved: [], notifications: [], muted: [], blocked: [],
    view: 'home', activeChat: null, updatedAt: now(), settings: {theme:'dark', compact:false, autoplay:true, dataSaver:false}
  });
  let state = loadState();
  let client = null;
  let relayIndex = 0;
  let cryptoKey = null;
  let topicRoot = '';
  let selectedMedia = null;
  let selectedMediaType = '';
  let installPrompt = null;

  function loadState() {
    try { return {...defaultState(), ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}')}; }
    catch { return defaultState(); }
  }
  function persist() {
    state.updatedAt = now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch { toast('Storage is full. Enable Data Saver or remove older media.'); }
  }
  function initials(name) { return String(name || 'G').split(/\s+/).map(x => x[0]).join('').slice(0,2).toUpperCase(); }
  function avatar(profile, size = '') {
    if (!profile) return `<span class="avatar ${size}">?</span>`;
    return profile.avatar
      ? `<img class="avatar ${size}" src="${profile.avatar}" alt="${esc(profile.name)}">`
      : `<span class="avatar ${size}" style="background:${profile.color || gradients[0]}">${esc(initials(profile.name))}</span>`;
  }
  function profileBy(id) { return state.profiles.find(p => p.id === id) || (state.profile?.id === id ? state.profile : null); }
  function relative(ts) {
    const seconds = Math.max(1, Math.floor((now() - ts) / 1000));
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds/60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h`;
    if (seconds < 604800) return `${Math.floor(seconds/86400)}d`;
    return new Date(ts).toLocaleDateString(undefined, {month:'short', day:'numeric'});
  }
  function toast(message) {
    const node = document.createElement('div'); node.className = 'toast'; node.textContent = message;
    $('#toastStack').append(node); setTimeout(() => node.remove(), 3200);
  }
  function setView(view) {
    if (view === 'create') return openCreate();
    state.view = view; persist(); render(); window.scrollTo({top:0, behavior:'smooth'});
  }

  function seedCommunity() {
    if (state.profiles.length > 1 || state.posts.length) return;
    const people = [
      ['Nova Ray','nova','Making ordinary days look cinematic.'], ['Milo Chen','milo','Street frames and late-night coffee.'],
      ['Iris Vale','iris','Design, color, little adventures.'], ['Kai Woods','kai','Trails, sound, and slow mornings.'],
      ['Lena Sol','lena','Food stories from tiny kitchens.']
    ].map((p, i) => ({id:`demo-${i}`, name:p[0], handle:p[1], bio:p[2], color:gradients[i%gradients.length], createdAt:now()-86400000*(i+2), updatedAt:now()}));
    state.profiles = [state.profile, ...people];
    const captions = [
      ['demo-0','A quiet orbit around the city lights.','#101431','#8f4cff'],
      ['demo-1','Found geometry hiding in the rain.','#042a3a','#12c8c4'],
      ['demo-2','Color study: electric hour.','#3a0f3f','#ff647c'],
      ['demo-3','No signal, perfect connection.','#0e302a','#65df9d'],
      ['demo-4','Sunday tastes better shared.','#4a2517','#ff9b57']
    ];
    state.posts = captions.map((p,i) => ({id:`seed-${i}`, userId:p[0], caption:p[1], media:'', mediaType:'placeholder', colors:[p[2],p[3]], createdAt:now()-3600000*(i+1), updatedAt:now(), likes:i?people.slice(0,i).map(x=>x.id):[], comments:i%2?[{id:uid(),userId:people[(i+1)%people.length].id,text:'This belongs in a frame ✨',createdAt:now()-100000*i}]:[], type:i===2?'reel':'post'}));
    state.stories = people.slice(0,4).map((p,i)=>({id:`story-${i}`,userId:p.id,media:'',colors:[gradients[i], '#090b18'],caption:['Night walk','New work','Today’s mood','Out here'][i],createdAt:now()-600000*i,updatedAt:now()}));
    state.notifications = [{id:uid(),type:'welcome',text:'Welcome to your private circle.',createdAt:now(),read:false}];
    state.activeChat = people[0].id;
    state.messages[people[0].id] = [{id:uid(),from:people[0].id,to:state.profile.id,text:'Welcome to GscNet 👋 Your circle is private by design.',createdAt:now()-60000,updatedAt:now()}];
    persist();
  }

  function renderNav() {
    $('#mainNav').innerHTML = nav.map(([id,label]) => `<button class="nav-item ${state.view===id?'active':''}" data-view="${id}"><span class="nav-icon">${icons[id]}</span><span class="nav-label">${label}</span>${id==='notifications' && unreadCount() ? '<i class="nav-dot"></i>':''}</button>`).join('');
    $('#mobileNav').innerHTML = mobileViews.map(id => `<button class="nav-item ${state.view===id?'active':''}" data-view="${id}" aria-label="${id}"><span class="nav-icon">${id==='create'?'＋':icons[id]}</span>${id==='profile'?avatar(state.profile,'sm'):''}${id==='notifications'&&unreadCount()?'<i class="nav-dot"></i>':''}</button>`).join('').replace(/<span class="nav-icon">◎<\/span><img|<span class="nav-icon">◎<\/span><span/, match => match.includes('<img')?'<img':'<span');
    const p = state.profile;
    $('#profileMini').innerHTML = p ? `${avatar(p,'sm')}<div><strong>${esc(p.name)}</strong><small>@${esc(p.handle)}</small></div>` : '';
    $('#notifBadge').textContent = unreadCount() || '';
  }
  function unreadCount() { return state.notifications.filter(n=>!n.read).length; }
  function render() {
    if (!state.profile) return showOnboarding();
    renderNav();
    const renderers = {home:renderHome, explore:renderExplore, reels:renderReels, messages:renderMessages, notifications:renderNotifications, profile:renderProfile, saved:renderSaved, settings:renderSettings};
    (renderers[state.view] || renderHome)();
    renderRail();
  }

  function renderHome() {
    const feed = [...state.posts].filter(p=>!p.deleted).sort((a,b)=>b.createdAt-a.createdAt);
    $('#view').innerHTML = `
      <div class="connection-banner glass-card"><span>Private circle: <strong>${esc(state.community?.name || 'GscNet')}</strong></span><button class="text-button" data-action="invite">Invite</button></div>
      <div class="stories">${storyMarkup()}</div>
      <div class="composer-strip glass-card">${avatar(state.profile,'sm')}<button data-action="create">Share with your circle…</button><div class="quick-actions"><button class="chip" data-action="create-photo">▧</button><button class="chip" data-action="create-story">◉</button></div></div>
      <div class="feed" id="feed">${feed.length ? feed.map(postMarkup).join('') : emptyMarkup('▧','Your circle is quiet','Create the first post or invite someone you trust.')}</div>`;
  }
  function storyMarkup() {
    const stories = state.stories.filter(s=>!s.deleted && now()-s.createdAt<86400000).sort((a,b)=>b.createdAt-a.createdAt);
    return `<button class="story add" data-action="create-story"><span class="story-ring">${avatar(state.profile)}</span><span>Your story</span></button>` + stories.map(s=>{
      const p=profileBy(s.userId); return `<button class="story" data-story="${s.id}"><span class="story-ring ${s.seen?'seen':''}">${avatar(p)}</span><span>${esc(p?.handle||'member')}</span></button>`;
    }).join('');
  }
  function postMarkup(post) {
    const p = profileBy(post.userId) || {name:'Member',handle:'member',color:gradients[0]};
    const liked = post.likes?.includes(state.profile.id); const saved=state.saved.includes(post.id);
    const media = post.media ? (post.mediaType==='video' ? `<video src="${post.media}" ${state.settings.autoplay?'autoplay muted loop playsinline':'controls playsinline'}></video>` : `<img src="${post.media}" alt="Post by ${esc(p.name)}" loading="lazy">`) : `<div class="media-placeholder" style="background:linear-gradient(145deg,${post.colors?.[0]||'#462680'},${post.colors?.[1]||'#106c93'})">${esc(post.caption.split(/[.!?]/)[0])}</div>`;
    return `<article class="post-card glass-card" data-post="${post.id}">
      <header class="post-head">${avatar(p,'sm')}<div class="post-author"><strong>${esc(p.name)}</strong><small>@${esc(p.handle)} · ${relative(post.createdAt)}</small></div><button class="more-button" data-action="post-menu" aria-label="More">•••</button></header>
      <div class="post-media" data-action="toggle-like">${media}${post.type==='reel'?'<span class="carousel-count">REEL</span>':''}</div>
      <div class="post-actions"><button class="${liked?'liked':''}" data-action="like" aria-label="Like">${liked?'♥':'♡'}</button><button data-action="comment" aria-label="Comment">◯</button><button data-action="share" aria-label="Share">⌁</button><span class="spacer"></span><button class="${saved?'saved':''}" data-action="save" aria-label="Save">${saved?'◆':'◇'}</button></div>
      <div class="post-copy"><div class="likes">${post.likes?.length||0} ${post.likes?.length===1?'like':'likes'}</div><p><span class="caption-user">${esc(p.handle)}</span>${linkify(post.caption)}</p></div>
      <div class="comments-preview">${post.comments?.length?`<button data-action="comment">View all ${post.comments.length} comments</button>`:'<button data-action="comment">Add a comment…</button>'}</div></article>`;
  }
  function linkify(text) { return esc(text).replace(/(^|\s)(#[\w-]+)/g,'$1<span style="color:#8ecfff">$2</span>'); }

  function renderExplore() {
    const posts=state.posts.filter(p=>!p.deleted); $('#view').innerHTML = `<div class="section-head"><div><h1>Explore</h1><p>Discover your private circle</p></div></div><label class="search-box"><input id="exploreSearch" placeholder="Search people, captions, hashtags"></label><div class="grid" id="exploreGrid">${posts.map(gridMarkup).join('')}</div>`;
  }
  function gridMarkup(p) { const media=p.media?(p.mediaType==='video'?`<video src="${p.media}" muted playsinline></video>`:`<img src="${p.media}" alt="" loading="lazy">`):`<div class="grid-placeholder" style="background:linear-gradient(145deg,${p.colors?.join(',')||'#6339c5,#126e97'})">${esc(p.caption.slice(0,38))}</div>`; return `<button class="grid-item" data-open-post="${p.id}" data-stats="♥ ${p.likes?.length||0}  ◯ ${p.comments?.length||0}">${media}</button>`; }
  function renderReels() {
    let reels=state.posts.filter(p=>!p.deleted && p.type==='reel'); if(!reels.length) reels=state.posts.filter(p=>!p.deleted).slice(0,3);
    $('#view').innerHTML = `<div class="reels">${reels.map(p=>{const u=profileBy(p.userId); return `<section class="reel" data-post="${p.id}"><div class="post-media">${p.media?(p.mediaType==='video'?`<video src="${p.media}" autoplay muted loop playsinline></video>`:`<img src="${p.media}" alt="">`):`<div class="media-placeholder" style="height:100%;background:linear-gradient(160deg,${p.colors?.join(',')||'#421f75,#063b62'})">${esc(p.caption)}</div>`}</div><div class="reel-overlay"><strong>@${esc(u?.handle||'member')}</strong><p>${esc(p.caption)}</p><small>♫ Original sound · GscNet</small></div><div class="reel-actions"><button data-action="like">${p.likes?.includes(state.profile.id)?'♥':'♡'}</button><button data-action="comment">◯</button><button data-action="share">⌁</button><button data-action="save">◇</button></div></section>`}).join('')}</div>`;
  }

  function renderMessages() {
    const people=state.profiles.filter(p=>p.id!==state.profile.id && !state.blocked.includes(p.id)); if(!state.activeChat && people[0]) state.activeChat=people[0].id;
    const active=profileBy(state.activeChat); const msgs=state.messages[state.activeChat]||[];
    $('#view').innerHTML = `<div class="section-head"><div><h1>Messages</h1><p>End-to-end encrypted with your invite key</p></div><button class="secondary-button" data-action="new-message">New</button></div><div class="message-layout glass-card"><aside class="conversation-list"><h2>Chats</h2>${people.map(p=>`<button class="conversation ${p.id===state.activeChat?'active':''}" data-chat="${p.id}">${avatar(p,'sm')}<span class="meta"><strong>${esc(p.name)}</strong><small>${esc((state.messages[p.id]?.at(-1)?.text)||'Start a chat')}</small></span></button>`).join('')}</aside><section class="chat">${active?`<header class="chat-head">${avatar(active,'sm')}<div><strong>${esc(active.name)}</strong><small style="display:block;color:var(--muted)">@${esc(active.handle)}</small></div></header><div class="messages" id="messages">${msgs.map(m=>`<div class="bubble ${m.from===state.profile.id?'mine':''}">${esc(m.text)}<small>${relative(m.createdAt)}</small></div>`).join('')||'<div class="empty-state">Messages are encrypted for this circle.</div>'}</div><form class="message-form" id="messageForm"><input name="message" autocomplete="off" maxlength="1000" placeholder="Message…"><button>➤</button></form>`:emptyMarkup('✦','Choose a conversation','Invite someone to start chatting.')}</section></div>`;
    requestAnimationFrame(()=>{const m=$('#messages'); if(m)m.scrollTop=m.scrollHeight;});
  }
  function renderNotifications() {
    state.notifications.forEach(n=>n.read=true); persist();
    $('#view').innerHTML = `<div class="section-head"><div><h1>Activity</h1><p>What happened in your circle</p></div><button class="text-button" data-action="clear-notifications">Clear</button></div><div class="list-panel glass-card">${state.notifications.length?state.notifications.sort((a,b)=>b.createdAt-a.createdAt).map(n=>`<div class="list-row"><span class="avatar sm">${n.type==='like'?'♥':n.type==='comment'?'◯':'✦'}</span><span class="meta"><strong>${esc(n.text)}</strong><small>${relative(n.createdAt)}</small></span></div>`).join(''):emptyMarkup('♡','All caught up','New activity will appear here.')}</div>`;
  }
  function renderProfile(targetId=state.profile.id) {
    const p=profileBy(targetId)||state.profile; const own=p.id===state.profile.id; const posts=state.posts.filter(x=>x.userId===p.id&&!x.deleted); const followers=state.profiles.filter(x=>x.id!==p.id&&state.follows.includes(p.id)).length; const following=own?state.follows.length:Math.min(12, state.profiles.length-1);
    $('#view').innerHTML = `<section class="profile-header glass-card"><div class="profile-top">${avatar(p,'lg')}<div class="profile-info"><h1>${esc(p.name)}</h1><div class="handle">@${esc(p.handle)}</div><div class="profile-stats"><button><strong>${posts.length}</strong><span>posts</span></button><button><strong>${followers}</strong><span>followers</span></button><button><strong>${following}</strong><span>following</span></button></div><div class="profile-buttons">${own?'<button class="secondary-button" data-action="edit-profile">Edit profile</button><button class="secondary-button" data-action="invite">Share profile</button>':`<button class="submit-button" data-follow="${p.id}">${state.follows.includes(p.id)?'Following':'Follow'}</button><button class="secondary-button" data-chat="${p.id}">Message</button>`}</div></div></div><p>${esc(p.bio||'Private by design. Real by choice.')}</p></section><div class="profile-tabs"><button class="active">▦ Posts</button><button>▶ Reels</button><button>◇ Tagged</button></div><div class="grid">${posts.map(gridMarkup).join('')||emptyMarkup('▦','No posts yet','Your shared moments will appear here.')}</div>`;
  }
  function renderSaved() { const posts=state.posts.filter(p=>state.saved.includes(p.id)&&!p.deleted); $('#view').innerHTML=`<div class="section-head"><div><h1>Saved</h1><p>Only you can see saved posts</p></div></div><div class="grid">${posts.map(gridMarkup).join('')||emptyMarkup('◇','Nothing saved yet','Tap the bookmark on a post to keep it here.')}</div>`; }
  function renderSettings() {
    $('#view').innerHTML=`<div class="section-head"><div><h1>Settings</h1><p>Privacy, network, and your device</p></div></div><div class="list-panel glass-card"><button class="list-row" data-action="invite"><span class="avatar sm">⌁</span><span class="meta"><strong>Invite & community key</strong><small>Share access to ${esc(state.community.name)}</small></span><span>›</span></button><button class="list-row" data-action="edit-profile"><span class="avatar sm">◎</span><span class="meta"><strong>Edit profile</strong><small>Name, handle, bio, photo</small></span><span>›</span></button><button class="list-row" data-action="toggle-data"><span class="avatar sm">◴</span><span class="meta"><strong>Data Saver</strong><small>${state.settings.dataSaver?'On':'Off'} · compress media for budget phones</small></span><span>${state.settings.dataSaver?'✓':''}</span></button><button class="list-row" data-action="toggle-autoplay"><span class="avatar sm">▶</span><span class="meta"><strong>Autoplay videos</strong><small>${state.settings.autoplay?'On':'Off'}</small></span><span>${state.settings.autoplay?'✓':''}</span></button>${installPrompt?'<button class="list-row" data-action="install"><span class="avatar sm">↓</span><span class="meta"><strong>Install GscNet</strong><small>Add the app to this device</small></span><span>›</span></button>':''}<button class="list-row" data-action="export"><span class="avatar sm">⇩</span><span class="meta"><strong>Export private backup</strong><small>Download your local data as JSON</small></span><span>›</span></button><button class="list-row" data-action="leave"><span class="avatar sm" style="background:#5b2430">×</span><span class="meta"><strong style="color:#ff8a9b">Leave this device profile</strong><small>Removes local content from this device</small></span><span>›</span></button></div><div class="privacy-note">🔒 GscNet has no central account database. Your invite key encrypts relay traffic. Anyone with the invite can join, so share it only with people you trust.</div>`;
  }
  function emptyMarkup(icon,title,text) { return `<div class="empty-state"><div class="big-icon">${icon}</div><strong>${title}</strong><p>${text}</p></div>`; }

  function renderRail() {
    const suggestions=state.profiles.filter(p=>p.id!==state.profile.id&&!state.follows.includes(p.id)).slice(0,3);
    $('#rightRail').innerHTML=`<div class="rail-card"><label class="search-box"><input id="railSearch" placeholder="Search GscNet"></label></div><div class="rail-card"><div class="rail-title"><h3>Your circle</h3><span class="status-pill">${client?.connected?'Synced':'Local'}</span></div><div><strong>${esc(state.community.name)}</strong><small style="display:block;color:var(--muted)">${state.profiles.length} members · invite only</small></div></div><div class="rail-card"><div class="rail-title"><h3>People to follow</h3><button class="text-button" data-view="explore">See all</button></div>${suggestions.map(p=>`<div class="suggestion">${avatar(p,'sm')}<span class="meta"><strong>${esc(p.name)}</strong><small>@${esc(p.handle)}</small></span><button class="follow-button" data-follow="${p.id}">Follow</button></div>`).join('')||'<small style="color:var(--muted)">You follow everyone here.</small>'}</div><div class="rail-card"><small style="color:var(--muted)">GscNet · Private by design<br>Local-first · Encrypted relay · PWA</small></div>`;
  }

  function showOnboarding() {
    $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal onboarding"><div class="onboard-art"><div><img src="assets/gscnet-icon-1024.png" alt="GscNet"><h1>GscNet</h1><p>Your private social circle. No password. No ads. No algorithm deciding who matters.</p></div><small>Encrypted invite rooms · local-first · works offline</small></div><form class="onboard-form form-grid" id="onboardForm"><div><h2>Create or join a circle</h2><p style="color:var(--muted)">Your identity stays on this device.</p></div><label class="field"><span>Display name</span><input name="name" required maxlength="40" placeholder="Viorel"></label><label class="field"><span>Username</span><input name="handle" required maxlength="24" pattern="[A-Za-z0-9_.]+" placeholder="viorel"></label><label class="field"><span>Circle name</span><input name="community" required maxlength="40" value="My Private Circle"></label><label class="field"><span>Invite code (leave blank to create one)</span><input name="invite" minlength="8" placeholder="Paste a GscNet invite"></label><div class="privacy-note">🔐 The invite is also the encryption key. There is no password recovery, so keep a copy.</div><button class="submit-button" type="submit">Enter GscNet</button></form></section></div>`;
  }

  function modal(title, body, wide=false) { $('#modalRoot').innerHTML=`<div class="modal-backdrop" data-action="backdrop"><section class="modal ${wide?'wide':''}"><header class="modal-head"><h2>${title}</h2><button class="close-button" data-action="close-modal">×</button></header><div class="modal-body">${body}</div></section></div>`; }
  function closeModal(){ $('#modalRoot').innerHTML=''; selectedMedia=null; selectedMediaType=''; }
  function openCreate(type='post') {
    modal('Create', `<form id="createForm" class="form-grid"><label class="field"><span>Format</span><select name="type"><option value="post" ${type==='post'?'selected':''}>Feed post</option><option value="story" ${type==='story'?'selected':''}>Story (24 hours)</option><option value="reel" ${type==='reel'?'selected':''}>Reel</option></select></label><button class="media-preview" type="button" data-action="pick-media"><span>＋ Choose a photo or short video<br><small>Media is compressed before encrypted sync</small></span></button><label class="field"><span>Caption</span><textarea name="caption" maxlength="1800" placeholder="Share something real…"></textarea></label><label class="field"><span>Location (optional)</span><input name="location" maxlength="60" placeholder="Somewhere private"></label><div class="modal-actions"><button type="button" class="secondary-button" data-action="close-modal">Cancel</button><button class="submit-button">Share</button></div></form>`);
  }
  function openComments(post) {
    const comments=post.comments||[]; modal('Comments', `<div class="list-panel">${comments.map(c=>{const p=profileBy(c.userId);return `<div class="list-row">${avatar(p,'sm')}<span class="meta"><strong>${esc(p?.handle||'member')}</strong><small style="white-space:normal;color:var(--text)">${esc(c.text)}</small></span><small>${relative(c.createdAt)}</small></div>`}).join('')||'<div class="empty-state">Start the conversation.</div>'}</div><form class="message-form" id="commentForm" data-post="${post.id}"><input name="comment" maxlength="500" placeholder="Add a comment…"><button>➤</button></form>`);
  }
  function openInvite() {
    const invite=`${state.community.name}::${state.community.invite}`; modal('Invite trusted people', `<div class="form-grid"><div class="invite-card"><small>GscNet private circle invite</small><div class="invite-code">${esc(invite)}</div></div><div class="privacy-note">Anyone with this code can read and post in the circle. Send it privately.</div><button class="submit-button" data-action="copy-invite" data-invite="${esc(invite)}">Copy invite</button>${navigator.share?'<button class="secondary-button" data-action="native-share">Share securely</button>':''}</div>`);
  }
  function openEditProfile() {
    modal('Edit profile', `<form class="form-grid" id="profileForm"><div style="display:flex;justify-content:center">${avatar(state.profile,'lg')}</div><button type="button" class="secondary-button" data-action="pick-avatar">Change profile photo</button><label class="field"><span>Name</span><input name="name" maxlength="40" required value="${esc(state.profile.name)}"></label><label class="field"><span>Username</span><input name="handle" pattern="[A-Za-z0-9_.]+" maxlength="24" required value="${esc(state.profile.handle)}"></label><label class="field"><span>Bio</span><textarea name="bio" maxlength="160">${esc(state.profile.bio||'')}</textarea></label><div class="modal-actions"><button class="submit-button">Save profile</button></div></form>`);
  }
  function openStory(id) {
    const s=state.stories.find(x=>x.id===id); if(!s)return; s.seen=true; persist(); const p=profileBy(s.userId);
    modal('', `<div style="position:relative;min-height:70vh;border-radius:18px;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;padding:18px;background:${s.media?'#090b14':`linear-gradient(155deg,${s.colors?.join(',')})`}"><div style="display:flex;align-items:center;gap:9px;z-index:2">${avatar(p,'sm')}<strong>${esc(p?.handle||'member')}</strong><small>${relative(s.createdAt)}</small></div>${s.media?(s.mediaType==='video'?`<video src="${s.media}" autoplay controls playsinline style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>`:`<img src="${s.media}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">`):''}<h2 style="z-index:2;text-align:center;text-shadow:0 2px 15px #000">${esc(s.caption||'')}</h2></div>`);
  }

  async function createIdentity(form) {
    const data=new FormData(form); let invite=String(data.get('invite')||'').trim(); let community=String(data.get('community')||'My Circle').trim();
    if(invite.includes('::')) [community, invite] = invite.split(/::(.+)/); if(!invite) invite=`gsc-${uid()}-${Math.random().toString(36).slice(2,10)}`;
    const p={id:uid(),name:String(data.get('name')).trim(),handle:String(data.get('handle')).trim().toLowerCase(),bio:'Building a smaller, kinder internet.',color:gradients[Math.floor(Math.random()*gradients.length)],createdAt:now(),updatedAt:now()};
    state={...defaultState(),profile:p,profiles:[p],community:{name:community,invite,createdAt:now()},activeChat:null}; persist(); closeModal(); seedCommunity(); await initSync(); render(); publishEntity('profiles',p);
  }

  async function fileToMedia(file, avatarMode=false) {
    if(file.type.startsWith('video/')) {
      const limit=state.settings.dataSaver?2_000_000:4_000_000; if(file.size>limit){toast(`Video must be under ${Math.round(limit/1e6)} MB for private sync.`);return null;}
      return {data:await readFile(file),type:'video'};
    }
    if(!file.type.startsWith('image/')){toast('Choose an image or video.');return null;}
    const data=await readFile(file); const img=await loadImage(data); const max=avatarMode?512:(state.settings.dataSaver?720:1080); const scale=Math.min(1,max/Math.max(img.width,img.height)); const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale)); canvas.getContext('2d',{alpha:false}).drawImage(img,0,0,canvas.width,canvas.height); return {data:canvas.toDataURL('image/jpeg',state.settings.dataSaver?.62:.76),type:'image'};
  }
  const readFile=file=>new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});
  const loadImage=src=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src});

  function addNotification(text,type='info') { state.notifications.unshift({id:uid(),text,type,createdAt:now(),read:false}); state.notifications=state.notifications.slice(0,100); }
  function toggleLike(id) { const p=state.posts.find(x=>x.id===id);if(!p)return; p.likes ||= []; const i=p.likes.indexOf(state.profile.id); i>=0?p.likes.splice(i,1):p.likes.push(state.profile.id);p.updatedAt=now();persist();publishEntity('posts',p);render(); }
  function toggleSave(id) { const i=state.saved.indexOf(id);i>=0?state.saved.splice(i,1):state.saved.push(id);persist();render(); }
  function toggleFollow(id) { const i=state.follows.indexOf(id);i>=0?state.follows.splice(i,1):state.follows.push(id);persist();render(); }

  async function initSync() {
    if(!state.community?.invite || !window.mqtt || !crypto.subtle) return;
    try {
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`gscnet:${state.community.invite}`));
      const bytes=new Uint8Array(digest); const hex=[...bytes].map(b=>b.toString(16).padStart(2,'0')).join(''); topicRoot=`gscnet/v1/${hex.slice(0,28)}`; cryptoKey=await crypto.subtle.importKey('raw',digest,{name:'AES-GCM'},false,['encrypt','decrypt']); connectRelay();
    } catch { toast('Encrypted relay unavailable; running locally.'); }
  }
  function connectRelay() {
    try { if(client) client.end(true); client=mqtt.connect(BROKERS[relayIndex],{clientId:`gsc-${state.profile.id.slice(0,8)}-${Math.random().toString(16).slice(2,8)}`,clean:true,connectTimeout:8000,reconnectPeriod:4000,keepalive:45});
      client.on('connect',()=>{client.subscribe(`${topicRoot}/#`); publishEntity('profiles',state.profile); renderRail();});
      client.on('message',async(topic,payload)=>{try{const entity=await decryptPayload(payload.toString());mergeRemote(topic,entity);}catch{}});
      client.on('error',()=>{}); client.on('offline',()=>renderRail());
    } catch {}
  }
  async function encryptPayload(obj) { const iv=crypto.getRandomValues(new Uint8Array(12));const raw=new TextEncoder().encode(JSON.stringify(obj));const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},cryptoKey,raw));const all=new Uint8Array(iv.length+cipher.length);all.set(iv);all.set(cipher,iv.length);let bin='';all.forEach(b=>bin+=String.fromCharCode(b));return btoa(bin); }
  async function decryptPayload(value) { const all=Uint8Array.from(atob(value),c=>c.charCodeAt(0));const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:all.slice(0,12)},cryptoKey,all.slice(12));return JSON.parse(new TextDecoder().decode(plain)); }
  async function publishEntity(type,entity,sub='') { if(!client?.connected||!cryptoKey)return;try{const payload=await encryptPayload({...entity,_sender:state.profile.id});client.publish(`${topicRoot}/${type}/${sub?`${sub}/`:''}${entity.id}`,payload,{qos:0,retain:true});}catch{} }
  function mergeRemote(topic,entity) {
    if(!entity?.id||entity._sender===state.profile.id)return; const parts=topic.slice(topicRoot.length+1).split('/'); const type=parts[0]; let changed=false;
    if(type==='profiles'){const i=state.profiles.findIndex(x=>x.id===entity.id);if(i<0){state.profiles.push(entity);addNotification(`${entity.name} joined your circle.`,'follow');changed=true}else if((state.profiles[i].updatedAt||0)<(entity.updatedAt||0)){state.profiles[i]=entity;changed=true}}
    if(type==='posts'||type==='stories'){const list=state[type];const i=list.findIndex(x=>x.id===entity.id);if(i<0){list.unshift(entity);addNotification(`${profileBy(entity.userId)?.handle||'Someone'} shared something new.`,'post');changed=true}else if((list[i].updatedAt||0)<(entity.updatedAt||0)){list[i]=entity;changed=true}}
    if(type==='messages'&&(entity.to===state.profile.id||entity.from===state.profile.id)){const peer=entity.from===state.profile.id?entity.to:entity.from;state.messages[peer]||=[];if(!state.messages[peer].some(x=>x.id===entity.id)){state.messages[peer].push(entity);addNotification(`${profileBy(entity.from)?.handle||'Someone'} sent you a message.`,'message');changed=true}}
    if(changed){persist();render();}
  }

  document.addEventListener('click', async event => {
    const viewBtn=event.target.closest('[data-view]'); if(viewBtn){setView(viewBtn.dataset.view);return;}
    const story=event.target.closest('[data-story]');if(story){openStory(story.dataset.story);return;}
    const chat=event.target.closest('[data-chat]');if(chat){state.activeChat=chat.dataset.chat;state.view='messages';persist();render();return;}
    const follow=event.target.closest('[data-follow]');if(follow){toggleFollow(follow.dataset.follow);return;}
    const openPost=event.target.closest('[data-open-post]');if(openPost){const p=state.posts.find(x=>x.id===openPost.dataset.openPost);modal('Post',postMarkup(p),true);return;}
    const postNode=event.target.closest('[data-post]'); const action=event.target.closest('[data-action]')?.dataset.action;
    if(postNode&&['like','toggle-like'].includes(action)){toggleLike(postNode.dataset.post);return;}
    if(postNode&&action==='save'){toggleSave(postNode.dataset.post);return;}
    if(postNode&&action==='comment'){openComments(state.posts.find(x=>x.id===postNode.dataset.post));return;}
    if(postNode&&action==='share'){const p=state.posts.find(x=>x.id===postNode.dataset.post);await shareText(`GscNet post: ${p.caption}`);return;}
    if(postNode&&action==='post-menu'){openPostMenu(state.posts.find(x=>x.id===postNode.dataset.post));return;}
    if(!action)return;
    if(action==='create'||action==='create-photo')openCreate('post');
    if(action==='create-story')openCreate('story');
    if(action==='close-modal'||action==='backdrop'&&event.target.classList.contains('modal-backdrop'))closeModal();
    if(action==='pick-media'||action==='pick-avatar'){const picker=$('#mediaPicker');picker.dataset.mode=action==='pick-avatar'?'avatar':'post';picker.accept=action==='pick-avatar'?'image/*':'image/*,video/*';picker.click();}
    if(action==='comment'&&postNode)openComments(state.posts.find(x=>x.id===postNode.dataset.post));
    if(action==='invite')openInvite();
    if(action==='copy-invite'){await navigator.clipboard.writeText(event.target.dataset.invite);toast('Invite copied.');}
    if(action==='native-share')shareText(`${state.community.name}::${state.community.invite}`);
    if(action==='edit-profile')openEditProfile();
    if(action==='clear-notifications'){state.notifications=[];persist();render();}
    if(action==='toggle-data'){state.settings.dataSaver=!state.settings.dataSaver;persist();render();}
    if(action==='toggle-autoplay'){state.settings.autoplay=!state.settings.autoplay;persist();render();}
    if(action==='install'&&installPrompt){installPrompt.prompt();installPrompt=null;render();}
    if(action==='export')exportBackup();
    if(action==='leave')confirmLeave();
  });

  document.addEventListener('submit', async event => {
    event.preventDefault();
    if(event.target.id==='onboardForm'){await createIdentity(event.target);return;}
    if(event.target.id==='createForm'){
      const d=new FormData(event.target);const type=String(d.get('type'));const entity={id:uid(),userId:state.profile.id,caption:String(d.get('caption')||'').trim()||'A moment on GscNet.',location:String(d.get('location')||'').trim(),media:selectedMedia||'',mediaType:selectedMediaType||'placeholder',colors:[gradients[Math.floor(Math.random()*gradients.length)],'#080b19'],createdAt:now(),updatedAt:now(),likes:[],comments:[],type:type==='story'?'story':type};
      if(type==='story'){state.stories.unshift(entity);publishEntity('stories',entity);}else{state.posts.unshift(entity);publishEntity('posts',entity);}persist();closeModal();state.view='home';render();toast(type==='story'?'Story shared for 24 hours.':'Shared with your circle.');return;
    }
    if(event.target.id==='commentForm'){const p=state.posts.find(x=>x.id===event.target.dataset.post);const d=new FormData(event.target);const text=String(d.get('comment')||'').trim();if(text){p.comments||=[];p.comments.push({id:uid(),userId:state.profile.id,text,createdAt:now()});p.updatedAt=now();persist();publishEntity('posts',p);openComments(p);}return;}
    if(event.target.id==='messageForm'){const d=new FormData(event.target);const text=String(d.get('message')||'').trim();if(!text)return;const m={id:uid(),from:state.profile.id,to:state.activeChat,text,createdAt:now(),updatedAt:now()};state.messages[state.activeChat]||=[];state.messages[state.activeChat].push(m);persist();publishEntity('messages',m,state.activeChat);renderMessages();return;}
    if(event.target.id==='profileForm'){const d=new FormData(event.target);state.profile={...state.profile,name:String(d.get('name')).trim(),handle:String(d.get('handle')).trim().toLowerCase(),bio:String(d.get('bio')).trim(),avatar:selectedMedia||state.profile.avatar,updatedAt:now()};const i=state.profiles.findIndex(x=>x.id===state.profile.id);if(i>=0)state.profiles[i]=state.profile;persist();publishEntity('profiles',state.profile);closeModal();render();toast('Profile updated.');}
  });

  $('#mediaPicker').addEventListener('change',async event=>{const file=event.target.files?.[0];if(!file)return;const avatarMode=event.target.dataset.mode==='avatar';toast('Optimizing media…');const result=await fileToMedia(file,avatarMode);event.target.value='';if(!result)return;selectedMedia=result.data;selectedMediaType=result.type;if(avatarMode){const img=$('.modal .avatar.lg');if(img){const replacement=document.createElement('img');replacement.className='avatar lg';replacement.src=result.data;img.replaceWith(replacement);}toast('Photo ready. Save your profile.');}else{const preview=$('.media-preview');if(preview)preview.innerHTML=result.type==='video'?`<video src="${result.data}" controls playsinline></video>`:`<img src="${result.data}" alt="Preview">`;}});
  document.addEventListener('input',event=>{if(event.target.id==='exploreSearch'){const q=event.target.value.toLowerCase();$('#exploreGrid').innerHTML=state.posts.filter(p=>!p.deleted&&(p.caption.toLowerCase().includes(q)||(profileBy(p.userId)?.handle||'').includes(q))).map(gridMarkup).join('')||emptyMarkup('⌕','No matches','Try another word or hashtag.');}});
  function openPostMenu(post){const own=post.userId===state.profile.id;modal('Post options',`<div class="form-grid">${own?`<button class="secondary-button" data-delete-post="${post.id}">Delete post</button>`:`<button class="secondary-button" data-block-user="${post.userId}">Block @${esc(profileBy(post.userId)?.handle||'member')}</button>`}<button class="secondary-button" data-action="share">Copy caption</button></div>`);const del=$('[data-delete-post]');if(del)del.onclick=()=>{post.deleted=true;post.updatedAt=now();persist();publishEntity('posts',post);closeModal();render();};}
  async function shareText(text){try{if(navigator.share)await navigator.share({title:'GscNet',text});else{await navigator.clipboard.writeText(text);toast('Copied.');}}catch{}}
  function exportBackup(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`gscnet-backup-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href);}
  function confirmLeave(){modal('Leave this device?',`<p>This removes the local profile and cached private content. It cannot remove copies already synchronized to other members.</p><div class="modal-actions"><button class="secondary-button" data-action="close-modal">Cancel</button><button class="submit-button" id="confirmLeave" style="background:#b8324a">Remove local profile</button></div>`);$('#confirmLeave').onclick=()=>{localStorage.removeItem(STORE_KEY);location.reload();};}
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
  if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.profile&&!client?.connected)initSync();});

  if(state.profile){seedCommunity();initSync();}
  render();
})();
