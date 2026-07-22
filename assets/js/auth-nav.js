// 부모용(B2C) 페이지 헤더/배너를 B2C 로그인 하나로 통일한다.
// - '로그인' 링크·로그인 배너 → 데모와 '같은' B2C 로그인 모달을 연다(별도 login.html 안 감).
// - 로그인 O → 배너 숨김 + '로그인' 링크를 '로그아웃'으로.
// login.html(B2B, 기관용)과 계정 시스템이 다르므로, 부모 페이지는 이 스크립트만 쓴다.
import { supabase } from "./supabase.js";
import { mountAuthUI } from "./auth.js";

const arr = (nl) => Array.prototype.slice.call(nl);

let authUI = null;
try { authUI = await mountAuthUI(); } catch (e) { /* #authArea 없어도 모달은 동작 */ }

function openLogin(e){ if(e) e.preventDefault(); if(authUI && authUI.openLogin) authUI.openLogin(); }
async function doLogout(e){ if(e) e.preventDefault(); try{ await supabase.auth.signOut(); }catch(_){} location.reload(); }

function apply(session){
  const authed = !!(session && session.user);

  // 1) 로그인 유도 배너: 로그인 시 숨김 / 로그아웃 시 표시 + 클릭하면 B2C 모달
  arr(document.querySelectorAll(".login-banner")).forEach((el)=>{
    el.style.display = authed ? "none" : "";
    if(!el.__csWired){ el.__csWired = true; el.addEventListener("click", openLogin); }
  });

  // 2) 헤더의 '로그인' 링크(배너 제외): B2C 모달로 열고, 로그인 상태면 '로그아웃'으로 전환
  arr(document.querySelectorAll('a[href="/login.html"], a[href="./login.html"], a[href="login.html"], a[href="#login"], a[href="#logout"]')).forEach((a)=>{
    if(a.classList.contains("login-banner")) return;
    if(authed){
      a.textContent = "로그아웃"; a.setAttribute("href", "#logout");
      if(a.__csMode !== "out"){ a.__csMode = "out"; }
    } else {
      a.textContent = "로그인"; a.setAttribute("href", "#login");
      if(a.__csMode !== "in"){ a.__csMode = "in"; }
    }
    if(!a.__csWired){
      a.__csWired = true;
      a.addEventListener("click", (e)=>{ e.preventDefault(); (a.__csMode === "out" ? doLogout : openLogin)(e); });
    }
  });
}

const { data } = await supabase.auth.getSession();
apply(data.session);
supabase.auth.onAuthStateChange((_e, session)=>{ apply(session); });
