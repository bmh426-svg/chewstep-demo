// 헤더/배너를 로그인 상태에 맞춰 전환(허브·개인용 공용).
// 계정 시스템이 둘(개인용 B2C / 기관 B2B)이라, '둘 중 하나라도 로그인'이면 로그인 상태로 본다.
// - 로그인 O → 로그인 배너 숨김 + '로그인' 링크를 '로그아웃'으로(양쪽 로그아웃).
// - 로그인 X → 배너 표시 + 클릭 시 개인용(B2C) 로그인 모달.
import { supabase } from "./supabase.js";                 // 개인용(B2C)
import { mountAuthUI } from "./auth.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 기관(B2B) 세션도 감지 (login.html과 같은 프로젝트/키 → 같은 저장소 세션을 읽음)
const sbB2B = createClient("https://qwfskemfsrkmlrdttvqy.supabase.co", "sb_publishable_5cL015aIZo-fRKwXM16RkQ_NbzkzibH");

const arr = (nl) => Array.prototype.slice.call(nl);

let authUI = null;
try { authUI = await mountAuthUI(); } catch (e) { /* #authArea 없어도 모달은 동작 */ }

function openLogin(e){ if(e) e.preventDefault(); if(authUI && authUI.openLogin) authUI.openLogin(); }
async function doLogout(e){
  if(e) e.preventDefault();
  try{ await supabase.auth.signOut(); }catch(_){}
  try{ await sbB2B.auth.signOut(); }catch(_){}
  location.reload();
}

function apply(authed){
  // 1) 로그인 유도 배너
  arr(document.querySelectorAll(".login-banner")).forEach((el)=>{
    el.style.display = authed ? "none" : "";
    if(!el.__csWired){ el.__csWired = true; el.addEventListener("click", openLogin); }
  });
  // 2) 헤더의 '로그인' 텍스트 링크(배너·카드 제외)
  arr(document.querySelectorAll('a[href="/login.html"], a[href="./login.html"], a[href="login.html"], a[href="#login"], a[href="#logout"]')).forEach((a)=>{
    if(a.classList.contains("login-banner")) return;
    if(a.classList.contains("path")) return;      // 허브의 기관용 '카드'는 건드리지 않음
    if(a.querySelector("*")) return;              // 자식 요소 있는 링크(카드 등) 제외 — 순수 텍스트 링크만
    if(authed){ a.textContent = "로그아웃"; a.setAttribute("href", "#logout"); a.__csMode = "out"; }
    else { a.textContent = "로그인"; a.setAttribute("href", "#login"); a.__csMode = "in"; }
    if(!a.__csWired){
      a.__csWired = true;
      a.addEventListener("click", (e)=>{ e.preventDefault(); (a.__csMode === "out" ? doLogout : openLogin)(e); });
    }
  });
}

async function refresh(){
  let authed = false;
  try{ const a = await supabase.auth.getSession(); if(a.data && a.data.session) authed = true; }catch(e){}
  if(!authed){ try{ const b = await sbB2B.auth.getSession(); if(b.data && b.data.session) authed = true; }catch(e){} }
  apply(authed);
}

refresh();
supabase.auth.onAuthStateChange(()=>{ refresh(); });
try{ sbB2B.auth.onAuthStateChange(()=>{ refresh(); }); }catch(e){}
