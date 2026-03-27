import { useState, useEffect } from "react";

const DEFAULT_CATEGORIES = [
  { id: "venue",      emoji: "🏛️", title: "웨딩홀",       color: "#C8A97E" },
  { id: "photo",      emoji: "📸", title: "스튜디오·촬영", color: "#9B8EC4" },
  { id: "dress",      emoji: "👗", title: "드레스·예복",   color: "#D4849A" },
  { id: "makeup",     emoji: "💄", title: "메이크업·헤어", color: "#E8A598" },
  { id: "invitation", emoji: "💌", title: "청첩장",         color: "#87B5A2" },
  { id: "honeymoon",  emoji: "✈️", title: "신혼여행",       color: "#7AAED4" },
  { id: "catering",   emoji: "🍽️", title: "케이터링",       color: "#C9A84C" },
  { id: "ceremony",   emoji: "💍", title: "예식 준비",      color: "#B87AB0" },
];

const INITIAL_TASKS = [
  { id: 1, catId: "venue",   text: "웨딩홀 투어 & 비교",      done: true,  date: "2025-03-01", memo: "강남 그랜드볼룸 방문 완료" },
  { id: 2, catId: "venue",   text: "계약 & 계약금 납부",       done: true,  date: "2025-03-15", memo: "" },
  { id: 3, catId: "venue",   text: "좌석 배치 확정",           done: false, date: "2025-07-20", memo: "" },
  { id: 4, catId: "photo",   text: "스드메 패키지 계약",       done: true,  date: "2025-03-20", memo: "루미에르 스튜디오" },
  { id: 5, catId: "photo",   text: "야외 촬영 날짜 확정",      done: false, date: "2025-06-15", memo: "" },
  { id: 6, catId: "dress",   text: "드레스 1차 피팅",          done: true,  date: "2025-04-10", memo: "아이보리 A라인 선택" },
  { id: 7, catId: "dress",   text: "드레스 최종 피팅",         done: false, date: "2025-08-15", memo: "" },
  { id: 8, catId: "makeup",  text: "메이크업 리허설",          done: false, date: "2025-07-05", memo: "" },
  { id: 9, catId: "invitation", text: "청첩장 디자인 선택",    done: false, date: "2025-06-01", memo: "" },
  { id: 10, catId: "honeymoon", text: "항공권 예약",           done: false, date: "2025-05-30", memo: "발리 7박 8일" },
];

const WEDDING_DATE_DEFAULT = "2025-09-20";
const STORAGE_KEYS = { tasks: "wp_tasks", info: "wp_info" };

function loadFromStorage(key, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch { return fallback; }
}

function getDays(weddingDate) {
  const today = new Date(); today.setHours(0,0,0,0);
  const wd = new Date(weddingDate);
  return Math.ceil((wd - today) / 86400000);
}
function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  return `${date.getMonth()+1}월 ${date.getDate()}일`;
}
function getDaysUntil(d) {
  if (!d) return "";
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.ceil((new Date(d) - today) / 86400000);
  if (diff < 0) return "지남";
  if (diff === 0) return "오늘";
  if (diff <= 7) return `D-${diff}`;
  return `${diff}일 후`;
}

const labelStyle = { fontSize: 12, color: "#B09080", fontWeight: 600, display: "block", marginBottom: 8, letterSpacing: 0.5 };
const inputStyle = { width: "100%", padding: "13px 16px", borderRadius: 14, border: "1.5px solid #EDE0D8", fontSize: 14, outline: "none", fontFamily: "inherit", color: "#2D1B0E", background: "#FFFAF7", boxSizing: "border-box" };

function InputModal({ mode, initial, categories, onSave, onClose, onDelete }) {
  const empty = { text: "", catId: categories[0]?.id || "", date: "", memo: "", done: false };
  const [form, setForm] = useState(initial || empty);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const cat = categories.find(c => c.id === form.catId);

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: "rgba(30,12,0,0.35)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: "100%", maxWidth: 430,
        background: "white", borderRadius: "28px 28px 0 0",
        padding: "28px 24px 40px",
        boxShadow: "0 -12px 60px rgba(0,0,0,0.12)",
        animation: "slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)",
      }}>
        <div style={{ width: 40, height: 4, background: "#E8DDD4", borderRadius: 2, margin: "0 auto 24px" }} />
        <div style={{ fontSize: 17, fontWeight: 700, color: "#2D1B0E", marginBottom: 22 }}>
          {mode === "add" ? "✏️ 새 항목 추가" : "✏️ 항목 수정"}
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>할 일</label>
          <input placeholder="예) 웨딩홀 계약금 납부" value={form.text} onChange={e => set("text", e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>카테고리</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {categories.map(c => (
              <button key={c.id} onClick={() => set("catId", c.id)} style={{
                padding: "7px 12px", borderRadius: 20, border: `1.5px solid ${form.catId === c.id ? c.color : "#E8DDD4"}`,
                background: form.catId === c.id ? `${c.color}18` : "white",
                color: form.catId === c.id ? c.color : "#9A8070",
                fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s",
              }}>
                {c.emoji} {c.title}
              </button>
            ))}
          </div>
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>예정 날짜</label>
          <input type="date" value={form.date} onChange={e => set("date", e.target.value)} style={inputStyle} />
        </div>
        <div style={{ marginBottom: 24 }}>
          <label style={labelStyle}>메모 (선택)</label>
          <input placeholder="간단한 메모를 남겨요" value={form.memo} onChange={e => set("memo", e.target.value)} style={inputStyle} />
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={() => { if (form.text.trim()) onSave(form); }}
            style={{
              flex: 1, padding: "15px", borderRadius: 16, border: "none",
              background: cat ? `linear-gradient(135deg, ${cat.color}, ${cat.color}CC)` : "#C8A97E",
              color: "white", fontSize: 15, fontWeight: 700, cursor: "pointer",
              opacity: form.text.trim() ? 1 : 0.5,
            }}>
            저장
          </button>
          {mode === "edit" && (
            <button onClick={onDelete} style={{
              padding: "15px 18px", borderRadius: 16,
              border: "1.5px solid #F0E0DC", background: "white",
              color: "#D4849A", fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>삭제</button>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ info, onSave, onClose }) {
  const [form, setForm] = useState(info);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  return (
    <div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:500,background:"rgba(30,12,0,0.35)",backdropFilter:"blur(6px)",display:"flex",alignItems:"flex-end",justifyContent:"center" }}>
      <div onClick={e=>e.stopPropagation()} style={{ width:"100%",maxWidth:430,background:"white",borderRadius:"28px 28px 0 0",padding:"28px 24px 40px",boxShadow:"0 -12px 60px rgba(0,0,0,0.12)",animation:"slideUp 0.3s cubic-bezier(0.34,1.56,0.64,1)" }}>
        <div style={{ width:40,height:4,background:"#E8DDD4",borderRadius:2,margin:"0 auto 24px" }}/>
        <div style={{ fontSize:17,fontWeight:700,color:"#2D1B0E",marginBottom:22 }}>💑 우리 정보 설정</div>
        <div style={{ marginBottom:16 }}>
          <label style={labelStyle}>신부 이름</label>
          <input value={form.bride} onChange={e=>set("bride",e.target.value)} placeholder="신부 이름" style={inputStyle}/>
        </div>
        <div style={{ marginBottom:16 }}>
          <label style={labelStyle}>신랑 이름</label>
          <input value={form.groom} onChange={e=>set("groom",e.target.value)} placeholder="신랑 이름" style={inputStyle}/>
        </div>
        <div style={{ marginBottom:24 }}>
          <label style={labelStyle}>결혼식 날짜</label>
          <input type="date" value={form.weddingDate} onChange={e=>set("weddingDate",e.target.value)} style={inputStyle}/>
        </div>
        <button onClick={()=>onSave(form)} style={{ width:"100%",padding:"15px",borderRadius:16,border:"none",background:"linear-gradient(135deg,#C8836E,#D4849A)",color:"white",fontSize:15,fontWeight:700,cursor:"pointer" }}>
          저장
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [tasks, setTasks] = useState(() => loadFromStorage(STORAGE_KEYS.tasks, INITIAL_TASKS));
  const [info, setInfo] = useState(() => loadFromStorage(STORAGE_KEYS.info, { bride: "서윤", groom: "준혁", weddingDate: WEDDING_DATE_DEFAULT }));
  const [page, setPage] = useState("home");
  const [activeCategory, setActiveCategory] = useState(null);
  const [modal, setModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [justChecked, setJustChecked] = useState(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEYS.tasks, JSON.stringify(tasks)); }, [tasks]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.info, JSON.stringify(info)); }, [info]);

  const categories = DEFAULT_CATEGORIES;
  const doneCount = tasks.filter(i => i.done).length;
  const totalCount = tasks.length;
  const progress = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const daysLeft = getDays(info.weddingDate);

  const upcoming = [...tasks]
    .filter(t => !t.done && t.date)
    .filter(t => { const d = new Date(t.date); const today = new Date(); today.setHours(0,0,0,0); const soon = new Date(today); soon.setDate(today.getDate()+30); return d >= today && d <= soon; })
    .sort((a,b) => new Date(a.date)-new Date(b.date));

  function toggleTask(id) {
    setTasks(ts => ts.map(t => t.id === id ? { ...t, done: !t.done } : t));
    setJustChecked(id); setTimeout(()=>setJustChecked(null), 600);
  }
  function addTask(form) {
    setTasks(ts => [...ts, { ...form, id: Date.now(), done: false }]);
    setModal(null);
  }
  function updateTask(form) {
    setTasks(ts => ts.map(t => t.id === form.id ? form : t));
    setModal(null);
  }
  function deleteTask(id) {
    setTasks(ts => ts.filter(t => t.id !== id));
    setModal(null);
  }

  const catData = activeCategory ? categories.find(c => c.id === activeCategory) : null;
  const catTasks = catData ? tasks.filter(t => t.catId === catData.id) : [];
  const catDone = catTasks.filter(t => t.done).length;

  return (
    <div style={{ minHeight:"100vh", maxWidth:430, margin:"0 auto", background:"#FFFAF7", fontFamily:"'Noto Sans KR',sans-serif", position:"relative", overflowX:"hidden" }}>

      {/* HOME */}
      {(page === "home") && (
        <div style={{ animation:"fadeUp 0.5s ease both" }}>
          <div style={{ background:"linear-gradient(160deg,#FFF0F5 0%,#FFF8F0 60%,#F4F0FF 100%)", padding:"52px 24px 32px", textAlign:"center", borderBottom:"1px solid #F5EDE0", position:"relative" }}>
            <button onClick={()=>setShowSettings(true)} style={{ position:"absolute",top:16,right:16,background:"none",border:"none",fontSize:20,cursor:"pointer",opacity:0.5 }}>⚙️</button>
            <div style={{ fontSize:11,letterSpacing:4,color:"#C8A97E",fontWeight:600,marginBottom:10,textTransform:"uppercase" }}>Our Wedding</div>
            <h1 style={{ fontFamily:"'Playfair Display',serif",fontSize:32,fontWeight:700,margin:"0 0 6px",color:"#2D1B0E",lineHeight:1.2 }}>
              {info.bride} <span style={{ fontStyle:"italic",color:"#C8A97E" }}>&</span> {info.groom}
            </h1>
            <div style={{ fontSize:13,color:"#B09080",marginBottom:28,letterSpacing:0.5 }}>
              {info.weddingDate.replace(/-/g,".")} 결혼식
            </div>
            <div style={{ display:"inline-flex",flexDirection:"column",alignItems:"center",background:"white",borderRadius:24,padding:"18px 44px",boxShadow:"0 8px 40px rgba(200,120,100,0.13)",border:"1px solid #F5E0D8",animation:"pulse 3s ease infinite" }}>
              <div style={{ fontSize:10,color:"#C8A97E",letterSpacing:3,fontWeight:700,marginBottom:2 }}>D-DAY</div>
              <div style={{ fontSize:50,fontWeight:700,lineHeight:1,fontFamily:"'Playfair Display',serif",background:"linear-gradient(135deg,#C8836E,#D4849A,#9B8EC4)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",backgroundSize:"200%",animation:"shimmer 4s linear infinite" }}>
                {daysLeft > 0 ? `-${daysLeft}` : daysLeft === 0 ? "오늘" : `+${Math.abs(daysLeft)}`}
              </div>
              <div style={{ fontSize:10,color:"#C0A898",marginTop:2 }}>결혼식까지</div>
            </div>
          </div>

          <div style={{ padding:"24px 20px", paddingBottom:100 }}>
            <div style={{ background:"white",borderRadius:22,padding:"20px 22px",boxShadow:"0 4px 24px rgba(0,0,0,0.04)",border:"1px solid #F5EDE0",marginBottom:20,display:"flex",alignItems:"center",gap:18 }}>
              <svg width={68} height={68} viewBox="0 0 68 68">
                <circle cx={34} cy={34} r={28} fill="none" stroke="#F5EDE0" strokeWidth={6}/>
                <circle cx={34} cy={34} r={28} fill="none" stroke="url(#g1)" strokeWidth={6} strokeLinecap="round"
                  strokeDasharray={`${2*Math.PI*28}`} strokeDashoffset={`${2*Math.PI*28*(1-progress/100)}`}
                  transform="rotate(-90 34 34)" style={{ transition:"stroke-dashoffset 1s ease" }}/>
                <defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#C8836E"/><stop offset="100%" stopColor="#D4849A"/></linearGradient></defs>
                <text x={34} y={38} textAnchor="middle" fontSize={13} fontWeight={700} fill="#2D1B0E">{progress}%</text>
              </svg>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:15,fontWeight:700,color:"#2D1B0E",marginBottom:3 }}>전체 진행률</div>
                <div style={{ fontSize:12,color:"#B09080",marginBottom:10 }}>{doneCount}개 완료 · {totalCount-doneCount}개 남음</div>
                <div style={{ height:6,background:"#F5EDE0",borderRadius:3 }}>
                  <div style={{ height:"100%",width:`${progress}%`,background:"linear-gradient(90deg,#C8836E,#D4849A)",borderRadius:3,transition:"width 1s ease" }}/>
                </div>
              </div>
            </div>

            {upcoming.length > 0 && (
              <div style={{ marginBottom:24 }}>
                <div style={{ fontSize:11,color:"#B09080",letterSpacing:2,fontWeight:700,marginBottom:12,textTransform:"uppercase" }}>📅 곧 다가오는 일정</div>
                {upcoming.slice(0,3).map(item => {
                  const cat = categories.find(c=>c.id===item.catId);
                  return (
                    <div key={item.id} onClick={()=>setModal({mode:"edit",item})} style={{ background:"white",borderRadius:16,padding:"14px 18px",display:"flex",alignItems:"center",gap:12,border:`1px solid ${cat?.color}30`,boxShadow:"0 2px 12px rgba(0,0,0,0.04)",marginBottom:8,cursor:"pointer" }}>
                      <div style={{ fontSize:22 }}>{cat?.emoji}</div>
                      <div style={{ flex:1 }}>
                        <div style={{ fontSize:13,fontWeight:600,color:"#2D1B0E" }}>{item.text}</div>
                        <div style={{ fontSize:11,color:"#B09080",marginTop:2 }}>{cat?.title} · {formatDate(item.date)}</div>
                      </div>
                      <div style={{ fontSize:11,fontWeight:700,padding:"4px 10px",borderRadius:20,backgroundColor:`${cat?.color}15`,color:cat?.color }}>
                        {getDaysUntil(item.date)}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div style={{ fontSize:11,color:"#B09080",letterSpacing:2,fontWeight:700,marginBottom:12,textTransform:"uppercase" }}>💍 카테고리별 준비</div>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
              {categories.map((cat,i) => {
                const ct = tasks.filter(t=>t.catId===cat.id);
                const cd = ct.filter(t=>t.done).length;
                const pct = ct.length ? Math.round((cd/ct.length)*100) : 0;
                return (
                  <div key={cat.id} onClick={()=>{setActiveCategory(cat.id);setPage("category");}}
                    style={{ background:"white",borderRadius:20,padding:"18px 16px",boxShadow:"0 4px 20px rgba(0,0,0,0.05)",border:`1px solid ${cat.color}25`,cursor:"pointer",transition:"transform 0.15s,box-shadow 0.15s",animation:`fadeUp 0.5s ${i*0.04}s ease both` }}
                    onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 28px ${cat.color}30`}}
                    onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 4px 20px rgba(0,0,0,0.05)"}}>
                    <div style={{ fontSize:28,marginBottom:10 }}>{cat.emoji}</div>
                    <div style={{ fontSize:13,fontWeight:700,color:"#2D1B0E",marginBottom:2 }}>{cat.title}</div>
                    <div style={{ fontSize:11,color:"#B09080",marginBottom:10 }}>{cd}/{ct.length} 완료</div>
                    <div style={{ height:5,background:`${cat.color}20`,borderRadius:3 }}>
                      <div style={{ height:"100%",width:`${pct}%`,backgroundColor:cat.color,borderRadius:3,transition:"width 0.8s ease" }}/>
                    </div>
                    {ct.length === 0 && <div style={{ fontSize:10,color:"#C8B8A8",marginTop:6 }}>항목 없음</div>}
                    {ct.length > 0 && pct === 100 && <div style={{ fontSize:10,color:cat.color,marginTop:6,fontWeight:700 }}>✓ 완료!</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* CATEGORY DETAIL */}
      {page === "category" && catData && (
        <div style={{ animation:"fadeUp 0.4s ease both" }}>
          <div style={{ background:`linear-gradient(160deg,${catData.color}15 0%,#FFFAF7 100%)`, padding:"52px 24px 28px", borderBottom:"1px solid #F5EDE0" }}>
            <button onClick={()=>setPage("home")} style={{ background:"none",border:"none",cursor:"pointer",fontSize:13,color:"#B09080",padding:0,marginBottom:16,display:"flex",alignItems:"center",gap:6 }}>← 돌아가기</button>
            <div style={{ fontSize:36,marginBottom:8 }}>{catData.emoji}</div>
            <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:700,margin:"0 0 4px",color:"#2D1B0E" }}>{catData.title}</h2>
            <div style={{ fontSize:13,color:"#B09080" }}>{catDone}/{catTasks.length} 완료</div>
            <div style={{ height:6,background:`${catData.color}20`,borderRadius:3,marginTop:14 }}>
              <div style={{ height:"100%",width:`${catTasks.length?Math.round(catDone/catTasks.length*100):0}%`,backgroundColor:catData.color,borderRadius:3,transition:"width 0.8s ease" }}/>
            </div>
          </div>

          <div style={{ padding:"20px 20px",paddingBottom:110 }}>
            {catTasks.length === 0 && (
              <div style={{ textAlign:"center",padding:"40px 0",color:"#C8B8A8" }}>
                <div style={{ fontSize:36,marginBottom:12 }}>📝</div>
                <div style={{ fontSize:14,fontWeight:500 }}>아직 항목이 없어요</div>
                <div style={{ fontSize:12,marginTop:4 }}>아래 + 버튼으로 추가해보세요</div>
              </div>
            )}
            {catTasks.map((item,idx) => (
              <div key={item.id} onClick={()=>setModal({mode:"edit",item})}
                style={{ background:"white",borderRadius:18,padding:"16px 18px",marginBottom:10,border:item.done?`1px solid ${catData.color}40`:"1px solid #F0E8E0",boxShadow:"0 2px 14px rgba(0,0,0,0.04)",animation:`fadeUp 0.4s ${idx*0.05}s ease both`,cursor:"pointer",opacity:item.done?0.72:1,transition:"opacity 0.3s" }}>
                <div style={{ display:"flex",alignItems:"flex-start",gap:14 }}>
                  <div onClick={e=>{e.stopPropagation();toggleTask(item.id);}}
                    style={{ width:26,height:26,borderRadius:8,flexShrink:0,marginTop:1,border:item.done?`2px solid ${catData.color}`:"2px solid #E0D0C8",background:item.done?catData.color:"transparent",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.25s",animation:justChecked===item.id?"checkPop 0.4s ease":"none" }}>
                    {item.done && <span style={{ color:"white",fontSize:13,fontWeight:700 }}>✓</span>}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:14,fontWeight:600,color:item.done?"#A09080":"#2D1B0E",textDecoration:item.done?"line-through":"none",marginBottom:4 }}>{item.text}</div>
                    {item.date && <div style={{ fontSize:11,color:"#B09080" }}>📅 {formatDate(item.date)}</div>}
                    {item.memo && <div style={{ fontSize:12,color:"#C0A898",marginTop:5,fontStyle:"italic" }}>"{item.memo}"</div>}
                  </div>
                  <div style={{ fontSize:10,fontWeight:700,padding:"3px 9px",borderRadius:12,backgroundColor:item.done?`${catData.color}15`:"#F5EDE0",color:item.done?catData.color:"#B09080",flexShrink:0 }}>
                    {item.done ? "완료" : getDaysUntil(item.date)}
                  </div>
                </div>
              </div>
            ))}
            {catDone > 0 && catDone === catTasks.length && (
              <div style={{ textAlign:"center",padding:"22px",background:`${catData.color}10`,borderRadius:20,border:`1px dashed ${catData.color}50`,marginTop:8 }}>
                <div style={{ fontSize:28,marginBottom:6 }}>🎉</div>
                <div style={{ fontSize:14,fontWeight:700,color:catData.color }}>모두 완료했어요!</div>
              </div>
            )}
          </div>

          <div style={{ position:"fixed",bottom:80,right:"50%",transform:"translateX(calc(50% - 16px))",zIndex:200 }}>
            <button onClick={()=>setModal({mode:"add",item:{catId:catData.id}})}
              style={{ width:52,height:52,borderRadius:"50%",border:"none",background:`linear-gradient(135deg,${catData.color},${catData.color}BB)`,color:"white",fontSize:26,cursor:"pointer",boxShadow:`0 6px 24px ${catData.color}50`,display:"flex",alignItems:"center",justifyContent:"center" }}>
              +
            </button>
          </div>
        </div>
      )}

      {/* TIMELINE */}
      {page === "timeline" && (
        <div style={{ animation:"fadeUp 0.4s ease both" }}>
          <div style={{ background:"linear-gradient(160deg,#FFF0F5,#FFF8F0)", padding:"52px 24px 28px", borderBottom:"1px solid #F5EDE0" }}>
            <div style={{ fontSize:11,color:"#C8A97E",letterSpacing:3,fontWeight:600,marginBottom:8,textTransform:"uppercase" }}>Timeline</div>
            <h2 style={{ fontFamily:"'Playfair Display',serif",fontSize:26,fontWeight:700,margin:0,color:"#2D1B0E" }}>전체 일정</h2>
          </div>
          <div style={{ padding:"20px",paddingBottom:110 }}>
            {tasks.length === 0 && (
              <div style={{ textAlign:"center",padding:"50px 0",color:"#C8B8A8" }}>
                <div style={{ fontSize:36,marginBottom:12 }}>🗓️</div>
                <div style={{ fontSize:14 }}>등록된 일정이 없어요</div>
              </div>
            )}
            {[...tasks].sort((a,b)=>new Date(a.date||"9999")-new Date(b.date||"9999")).map((item,idx,arr) => {
              const cat = categories.find(c=>c.id===item.catId);
              const showMonth = item.date && (idx===0 || new Date(item.date).getMonth()!==new Date(arr[idx-1].date||"9999").getMonth());
              return (
                <div key={item.id}>
                  {showMonth && (
                    <div style={{ fontSize:11,color:"#B09080",fontWeight:700,letterSpacing:2,margin:"18px 0 10px 48px",textTransform:"uppercase" }}>
                      {new Date(item.date).getFullYear()}년 {new Date(item.date).getMonth()+1}월
                    </div>
                  )}
                  <div onClick={()=>setModal({mode:"edit",item})} style={{ display:"flex",gap:14,marginBottom:10,alignItems:"flex-start",cursor:"pointer",animation:`fadeUp 0.4s ${idx*0.03}s ease both` }}>
                    <div style={{ display:"flex",flexDirection:"column",alignItems:"center",width:36 }}>
                      <div onClick={e=>{e.stopPropagation();toggleTask(item.id);}}
                        style={{ width:34,height:34,borderRadius:"50%",flexShrink:0,background:item.done?cat?.color:"white",border:`2px solid ${cat?.color||"#E0D0C8"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,cursor:"pointer",transition:"all 0.2s" }}>
                        {item.done?<span style={{ color:"white",fontWeight:700,fontSize:13 }}>✓</span>:cat?.emoji}
                      </div>
                      {idx<arr.length-1&&<div style={{ width:2,height:22,background:"#F0E8E0",marginTop:3 }}/>}
                    </div>
                    <div style={{ flex:1,background:"white",borderRadius:16,padding:"13px 16px",border:`1px solid ${cat?.color||"#E0D0C8"}25`,boxShadow:"0 2px 10px rgba(0,0,0,0.04)",opacity:item.done?0.7:1 }}>
                      <div style={{ fontSize:13,fontWeight:600,color:"#2D1B0E",textDecoration:item.done?"line-through":"none" }}>{item.text}</div>
                      <div style={{ fontSize:11,color:"#B09080",marginTop:3 }}>{cat?.title}{item.date?` · ${formatDate(item.date)}`:""}</div>
                      {item.memo&&<div style={{ fontSize:11,color:"#C0A898",marginTop:4,fontStyle:"italic" }}>"{item.memo}"</div>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Bottom Navigation */}
      <div style={{ position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"rgba(255,250,247,0.94)",backdropFilter:"blur(16px)",borderTop:"1px solid #F0E4DC",padding:"8px 0 20px",display:"flex",justifyContent:"space-around",alignItems:"center",zIndex:100 }}>
        {[
          {id:"home",emoji:"🏠",label:"홈"},
          {id:"timeline",emoji:"📋",label:"전체 일정"},
        ].map(nav=>{
          const active = page===nav.id;
          return (
            <button key={nav.id} onClick={()=>setPage(nav.id)} style={{ background:"none",border:"none",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,padding:"4px 36px",opacity:active?1:0.4,transition:"opacity 0.2s" }}>
              <span style={{ fontSize:22 }}>{nav.emoji}</span>
              <span style={{ fontSize:10,color:"#2D1B0E",fontWeight:active?700:400 }}>{nav.label}</span>
            </button>
          );
        })}
        <button onClick={()=>setModal({mode:"add",item:{catId:activeCategory||categories[0].id}})}
          style={{ position:"absolute",top:-22,left:"50%",transform:"translateX(-50%)",width:52,height:52,borderRadius:"50%",border:"3px solid #FFFAF7",background:"linear-gradient(135deg,#C8836E,#D4849A)",color:"white",fontSize:26,cursor:"pointer",boxShadow:"0 6px 24px rgba(200,120,100,0.4)",display:"flex",alignItems:"center",justifyContent:"center",fontWeight:300 }}>
          +
        </button>
      </div>

      {/* Modals */}
      {modal && (
        <InputModal
          mode={modal.mode}
          initial={modal.mode==="edit" ? modal.item : (modal.item || {})}
          categories={categories}
          onSave={form => modal.mode==="add" ? addTask(form) : updateTask(form)}
          onClose={()=>setModal(null)}
          onDelete={()=>deleteTask(modal.item.id)}
        />
      )}
      {showSettings && (
        <SettingsModal
          info={info}
          onSave={f=>{setInfo(f);setShowSettings(false);}}
          onClose={()=>setShowSettings(false)}
        />
      )}
    </div>
  );
}
