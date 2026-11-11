import { Menu } from "lucide-react";
import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Me } from "./api.ts";

/** 이 폭부터 채널 패널이 늘 보인다. 그보다 좁으면 대화만 두고 채널 패널은 서랍으로 연다(DESIGN.md 앱의 좁은 화면). */
const WIDE = "(min-width: 834px)";

/**
 * 앱 틀: 왼쪽 채널 패널과 가운데 대화 칸. 오른쪽 칸(멤버 목록, 내 에이전트)은 #19와 #21이 연다.
 * 좁은 화면에서는 같은 채널 패널을 왼쪽 서랍(모달 `<dialog>`)으로 연다.
 */
export function Workspace({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const wide = matchMedia(WIDE);
    const close = () => wide.matches && drawer.current?.close();
    wide.addEventListener("change", close);
    return () => wide.removeEventListener("change", close);
  }, []);

  return (
    <div className="app">
      <aside className="side-panel" aria-label="채널 패널">
        <ChannelPanel me={me} onLogout={onLogout} />
      </aside>
      <main className="conversation">
        {/* 채널 머리 띠. #20이 채널 이름과 멤버 수, 오른쪽의 내 에이전트·멤버 목록 버튼을 올린다. */}
        <header className="channel-header">
          <button
            type="button"
            className="header-button drawer-button"
            aria-label="채널 패널 열기"
            onClick={() => drawer.current?.showModal()}
          >
            <Menu size={18} aria-hidden />
          </button>
        </header>
        <div className="empty">
          <h2>아직 채널이 없어요</h2>
          <p>채널이 생기면 여기서 멤버들과 이야기해요.</p>
        </div>
      </main>
      {/* 덮개를 누르면 닫힌다. 키보드로는 Esc가 닫는다(dialog가 해 준다). */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog가 맡는다 */}
      <dialog
        ref={drawer}
        className="drawer"
        aria-label="채널 패널"
        onClick={(event) => event.target === event.currentTarget && drawer.current?.close()}
      >
        <div className="side-panel">
          <ChannelPanel me={me} onLogout={onLogout} />
        </div>
      </dialog>
    </div>
  );
}

function ChannelPanel({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <>
      {/* 워크스페이스 이름은 아직 따로 정하는 곳이 없다. 워크스페이스 하나에 레포 하나라(ADR-0012) 레포 이름을 쓴다. */}
      <div className="workspace">
        <h1>{me.repo.split("/")[1]}</h1>
        <p>{me.repo}</p>
      </div>
      <section className="channels">
        <h2 className="section-title">채널</h2>
        {/* #20이 채널 줄과 "채널 만들기"를 올린다. */}
        <p className="section-empty">아직 없어요</p>
      </section>
      <ProfilePanel me={me} onLogout={onLogout} />
    </>
  );
}

const Avatar = ({ name, size }: { name: string; size: 36 | 40 }) => (
  <span className={`avatar avatar-${size}`} aria-hidden>
    {/* 접속 점(온라인, 자리 비움, 방해 금지, 오프라인)은 아바타 오른쪽 아래에 붙는다. 1단계에 넣을지 아직 정하지 않았다. */}
    {Array.from(name)[0]?.toUpperCase()}
  </span>
);

/** 채널 패널 맨 아래의 프로필 패널. 누르면 바로 위에 메뉴가 열린다. */
function ProfilePanel({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useId();

  // 메뉴 바깥을 누르면 닫힌다.
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  // Esc는 메뉴만 닫는다. 서랍 안에서 열었어도 서랍은 그대로 둔다.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    button.current?.focus();
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: 안에 든 메뉴와 버튼의 Esc를 한곳에서 받는다
    <div className="profile" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="profile-button"
        aria-expanded={open}
        aria-controls={open ? menu : undefined}
        onClick={() => setOpen(!open)}
      >
        <Avatar name={me.name} size={36} />
        {/* 이름 아래 줄은 상태 메시지 자리다. 상태 메시지가 생기기 전까지 GitHub 아이디를 둔다. */}
        <span className="names">
          <strong>{me.name}</strong>
          <span>{me.login}</span>
        </span>
      </button>
      {/* 메뉴는 버튼 뒤에 둔다. 위에 떠 보여도 Tab은 버튼에서 메뉴로 간다. */}
      {open && (
        <div className="menu" id={menu}>
          <div className="menu-head">
            <Avatar name={me.name} size={40} />
            <div className="names">
              <strong>{me.name}</strong>
              <span>{me.login}</span>
            </div>
          </div>
          {/* 상태 메시지 칸과 접속 상태 고르기가 여기에 온다. 1단계에 넣을지 아직 정하지 않았다. */}
          <hr />
          <button type="button" className="menu-item" disabled>
            설정
            <span className="menu-note">준비 중</span>
          </button>
          <button type="button" className="menu-item danger" onClick={onLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
