"use client";

import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";

export const dynamic = "force-dynamic";

type Key = { id: string; name: string; createdAt: number };
type Status = {
  authenticated: boolean; registered: boolean; canBootstrap?: boolean; passkeys?: Key[];
};
type Note = { id: string; title: string; body: string; updated_at: number };
type Audit = { kind: string; outcome: string; detail: string; created_at: number };

async function api(action: string, extra: Record<string, unknown> = {}) {
  const result = await fetch("/api/passkey", {
    method: "POST", credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, ...extra }),
  });
  const data = await result.json() as Record<string, unknown>;
  if (!result.ok) throw new Error(typeof data.error === "string" ? data.error : `HTTP ${result.status}`);
  return data;
}

function koreanTime(value: number) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(value);
}

export default function PrivateSpace() {
  const [status, setStatus] = useState<Status | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const stateResponse = await fetch("/api/passkey", { cache: "no-store" });
    if (!stateResponse.ok) throw new Error("상태 조회 실패");
    const state = await stateResponse.json() as Status;
    setStatus(state);
    if (state.authenticated) {
      const privateResponse = await fetch("/api/private", { cache: "no-store" });
      if (!privateResponse.ok) throw new Error("비공개 자료 조회 실패");
      const data = await privateResponse.json() as { notes: Note[]; audit: Audit[] };
      setNotes(data.notes);
      setAudit(data.audit);
    } else {
      setNotes([]);
      setAudit([]);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => setError("상태를 불러오지 못했습니다. 새로고침해 주세요."));
  }, [refresh]);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try { await work(); }
    catch (caught) {
      setError(caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.");
    } finally { setBusy(false); }
  }

  function register() {
    void run(async () => {
      if (!window.PublicKeyCredential) throw new Error("이 브라우저는 패스키를 지원하지 않습니다.");
      const options = await api("register-options", { name });
      const response = await startRegistration({
        optionsJSON: options.options as PublicKeyCredentialCreationOptionsJSON,
      });
      await api("register-verify", { response });
      setName("");
      setMessage("서명이 확인되어 패스키의 공개키가 서버에 등록되었습니다.");
      await refresh();
    });
  }

  function login() {
    void run(async () => {
      if (!window.PublicKeyCredential) throw new Error("이 브라우저는 패스키를 지원하지 않습니다.");
      const options = await api("login-options");
      const response = await startAuthentication({
        optionsJSON: options.options as PublicKeyCredentialRequestOptionsJSON,
      });
      await api("login-verify", { response });
      setMessage("새 질문에 대한 서명이 확인되어 로그인했습니다.");
      await refresh();
    });
  }

  function logout() {
    void run(async () => {
      await api("logout");
      setMessage("서버 세션을 종료했습니다. 비공개 자료가 잠겼습니다.");
      await refresh();
    });
  }

  function removeKey(key: Key) {
    if (!window.confirm(`‘${key.name}’ 패스키를 이 사이트에서 삭제할까요? 마지막 패스키라면 다시 소유자 확인 후 등록해야 합니다.`)) return;
    void run(async () => {
      const response = await api("delete-passkey", { id: key.id });
      setMessage(Number(response.remaining) > 0
        ? "패스키를 삭제했습니다. 남은 패스키로 로그인할 수 있습니다."
        : "마지막 패스키를 삭제했습니다. 소유자 확인 후 새로 등록할 수 있습니다.");
      await refresh();
    });
  }

  function saveNote(note: Note) {
    void run(async () => {
      const result = await fetch("/api/private", {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: note.id, body: note.body }),
      });
      if (!result.ok) {
        const data = await result.json() as { error?: string };
        throw new Error(data.error || "저장 실패");
      }
      setMessage(`‘${note.title}’을(를) 비공개로 저장했습니다.`);
      await refresh();
    });
  }

  return (
    <div className="private-shell">
      <nav className="private-top" aria-label="비공개 영역 메뉴">
        <a href="/" className="brand">An Seok Ju</a>
        <a href="/" className="back-link">← 공개 소개로 돌아가기</a>
      </nav>
      <main className="private-main">
        <div className="private-heading">
          <span className="eyebrow">PRIVATE SPACE · PASSKEY</span>
          <h1>나만 보는 공간</h1>
          <p>공개 소개와 이 공간의 경계는 서버에서 확인합니다. 등록된 패스키로 서명해야 개인 메모가 열립니다.</p>
        </div>

        {message && <p className="private-alert success" role="status">{message}</p>}
        {error && <p className="private-alert failure" role="alert">{error}</p>}
        {!status && !error && <p className="private-panel">상태 확인 중…</p>}

        {status && !status.authenticated && (
          <section className="private-panel" aria-labelledby="access-heading">
            <span className="num">01 · ACCESS</span>
            <h2 id="access-heading">{status.registered ? "패스키로 로그인" : "첫 패스키 등록"}</h2>
            {status.registered ? (
              <>
                <p>로그인할 때마다 서버가 새 질문을 보냅니다. 저장된 공개키로 서명을 확인한 뒤에만 메모를 내려줍니다.</p>
                <button className="private-primary" disabled={busy} onClick={login}>패스키로 로그인</button>
              </>
            ) : status.canBootstrap ? (
              <>
                <p>소유자 확인이 끝났습니다. 이 기기에서 패스키를 등록하세요. 실제 연락처나 신분증 번호는 입력하지 마세요.</p>
                <label htmlFor="first-passkey-name">패스키 이름</label>
                <input id="first-passkey-name" value={name} maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="예: 내 노트북" autoComplete="off" />
                <button className="private-primary" disabled={busy || name.trim().length < 2}
                  onClick={register}>첫 패스키 등록</button>
              </>
            ) : (
              <>
                <p>처음 등록은 사이트 소유자 확인이 필요합니다. 다른 방문자는 등록할 수 없습니다.</p>
                <a className="private-primary" href="/signin-with-chatgpt?return_to=%2Fprivate" target="_top">
                  ChatGPT로 소유자 확인
                </a>
              </>
            )}
          </section>
        )}

        {status?.authenticated && (
          <>
            <div className="private-status">
              <div><span className="num">잠금 해제됨</span><p>패스키 서명으로 확인된 세션에서만 보입니다.</p></div>
              <button className="private-outline" disabled={busy} onClick={logout}>로그아웃</button>
            </div>
            <section className="private-panel" aria-labelledby="notes-heading">
              <span className="num">02 · PRIVATE NOTES</span>
              <h2 id="notes-heading">비공개 메모 세 가지</h2>
              <p>이 내용은 공개 소개 HTML에 포함되지 않습니다. 서버가 로그인 세션을 확인한 뒤 전달합니다.</p>
              <div className="private-grid">
                {notes.map((note) => (
                  <article className="private-note" key={note.id}>
                    <h3>{note.title}</h3>
                    <label className="sr-only" htmlFor={note.id}>{note.title} 내용</label>
                    <textarea id={note.id} value={note.body} maxLength={1000}
                      placeholder="나만 볼 메모를 적어 주세요."
                      onChange={(event) => setNotes((old) => old.map((item) =>
                        item.id === note.id ? { ...item, body: event.target.value } : item))}
                    />
                    <button className="private-outline" disabled={busy} onClick={() => saveNote(note)}>저장</button>
                  </article>
                ))}
              </div>
            </section>
            <section className="private-panel" aria-labelledby="keys-heading">
              <span className="num">03 · PASSKEYS</span>
              <h2 id="keys-heading">등록된 패스키</h2>
              <p>서버에는 패스키의 공개키와 이름만 저장합니다. 개인키와 생체 정보는 기기의 패스키 관리자에 남습니다.</p>
              <ul className="passkey-list">
                {status.passkeys?.map((key) => (
                  <li key={key.id}>
                    <span><b>{key.name}</b><small>등록 {koreanTime(key.createdAt)} KST</small></span>
                    <button className="private-outline" disabled={busy} onClick={() => removeKey(key)}>삭제</button>
                  </li>
                ))}
              </ul>
              <div className="private-add">
                <label htmlFor="another-passkey-name">다른 기기 또는 브라우저의 패스키 이름</label>
                <div><input id="another-passkey-name" value={name} maxLength={40}
                  onChange={(event) => setName(event.target.value)} placeholder="예: 내 휴대전화" />
                  <button className="private-primary" disabled={busy || name.trim().length < 2}
                    onClick={register}>패스키 추가</button></div>
              </div>
            </section>
            <section className="private-panel" aria-labelledby="audit-heading">
              <span className="num">04 · VERIFICATION</span>
              <h2 id="audit-heading">서버 확인 기록</h2>
              <p>질문 발급, 서명 성공과 거절 결과만 남깁니다. 서명 원문·토큰·생체 정보는 기록하지 않습니다.</p>
              <ul className="audit-list">
                {audit.map((item, index) => (
                  <li key={index}><time>{koreanTime(item.created_at)} KST</time>
                    <b>{item.kind} · {item.outcome}</b><span>{item.detail}</span></li>
                ))}
              </ul>
            </section>
          </>
        )}
        <p className="private-footnote">패스키는 기기 또는 브라우저의 패스키 관리자에 보관됩니다. 마지막 패스키를 지우면 소유자 확인 후 새로 등록해야 합니다.</p>
      </main>
    </div>
  );
}
