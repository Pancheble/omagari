import type { MemberView } from "@omagari/contract";
import { ExternalLink } from "lucide-react";
import {
  createContext,
  type MouseEvent,
  type ReactNode,
  use,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IdleAgent, WorkItem } from "./members.tsx";
import { StatusText } from "./profile.tsx";
import { Avatar, Dot, PRESENCE_WORDS, personName } from "./workspace.tsx";

/** 카드가 보이는 작업의 수(DESIGN.md "프로필 카드"). 나머지는 "작업 N개 더"로 전체 보기에서 본다. */
const CARD_WORKS = 2;
const CARD_WIDTH = 320;
const GAP = 8;

/** 카드를 열 자리: 누른 것(초점을 돌려줄 곳)과, 카드를 어느 쪽 옆에 둘지. */
export type Opened = { login: string; anchor: HTMLElement; side: "right" | "left" };

/** 앱 틀이 채운다. 사람을 누르는 곳(`Person`)이 멤버 목록과 카드 여는 법을 여기서 읽는다. */
export const PeopleContext = createContext<{
  members: MemberView[];
  open: (opened: Opened) => void;
}>({ members: [], open: () => {} });

/**
 * 사람 이름이나 아바타를 감싸 누르면 프로필 카드가 뜨게 한다. 멤버 목록에 없는 사람(GitHub에서 단 댓글 등)은 감싸지 않는다.
 * `inLink`는 링크 안에 들어 있어 버튼을 중첩할 수 없는 자리다(포럼 카드). 마우스로만 열고, 키보드는 멤버 목록의 행으로 연다.
 */
export function Person({
  login,
  side = "right",
  inLink = false,
  avatar = false,
  className,
  children,
}: {
  login: string;
  side?: "right" | "left";
  inLink?: boolean;
  /** 아바타만 감싼다: 이름 버튼이 옆에 있어 키보드와 화면 읽기에서는 뺀다. */
  avatar?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { members, open } = use(PeopleContext);
  if (!members.some((member) => member.login === login))
    return <span className={className}>{children}</span>;
  const click = (event: MouseEvent<HTMLElement>) => {
    if (inLink) {
      event.preventDefault();
      event.stopPropagation();
    }
    open({ login, anchor: event.currentTarget, side });
  };
  const classes = ["person", className].filter(Boolean).join(" ");
  return inLink ? (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: 링크 안이라 버튼을 못 둔다. 키보드는 멤버 목록의 행으로 연다
    <span className={classes} onClick={click}>
      {children}
    </span>
  ) : (
    <button
      type="button"
      className={classes}
      aria-haspopup="dialog"
      aria-hidden={avatar || undefined}
      tabIndex={avatar ? -1 : undefined}
      onClick={click}
    >
      {children}
    </button>
  );
}

/** 이름·로그인 링크·접속 상태·상태 메시지: 카드와 전체 보기의 머리가 같은 꼴이다. */
function Identity({ member, big }: { member: MemberView; big?: boolean }) {
  const named = member.name && member.name !== member.login;
  return (
    <>
      <div className="profile-id">
        <Avatar
          name={member.name}
          login={member.login}
          size={big ? 80 : 64}
          presence={member.presence}
        />
        <div className="profile-who">
          <h3>{named ? member.name : member.login}</h3>
          <a
            className="profile-login"
            href={`https://github.com/${member.login}`}
            target="_blank"
            rel="noreferrer"
          >
            {named ? member.login : "GitHub"}
            <ExternalLink size={12} aria-hidden />
          </a>
          <p className="profile-presence">
            <Dot presence={member.presence} aria-hidden />
            {PRESENCE_WORDS[member.presence]}
          </p>
        </div>
      </div>
      {(member.message !== null || member.emoji !== null) && (
        <p className="profile-message">
          <StatusText {...member} />
        </p>
      )}
    </>
  );
}

/** 카드 맨 위 제목 줄 */
const Heading = ({ children }: { children: ReactNode }) => (
  <h4 className="profile-heading">{children}</h4>
);

/**
 * 프로필 카드: 누른 자리 옆에 뜨는 작은 카드. 모달 `<dialog>`라 Esc와 바깥 누르기로 닫히고 다른 시트 위에도 뜬다.
 * 닫히면 초점이 누른 자리로 돌아간다. 833px 이하는 CSS가 아래 시트로 바꾼다.
 */
export function ProfileCard({
  opened,
  member,
  direct,
  onFull,
  onClose,
}: {
  opened: Opened;
  member: MemberView;
  direct: Set<string>;
  onFull: (login: string) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [top, setTop] = useState(0);
  const rect = opened.anchor.getBoundingClientRect();
  const left = Math.max(
    GAP,
    opened.side === "left" || rect.right + GAP + CARD_WIDTH > innerWidth - GAP
      ? rect.left - GAP - CARD_WIDTH
      : rect.right + GAP,
  );
  useEffect(() => dialog.current?.showModal(), []);
  // 창 아래로 넘치면 창 안에 들게 위로 올린다.
  useLayoutEffect(() => {
    const height = dialog.current?.offsetHeight ?? 0;
    setTop(Math.max(GAP, Math.min(rect.top, innerHeight - GAP - height)));
  }, [rect.top]);
  // 닫히면(대화 상자가 치워진 뒤) 초점이 누른 자리로 돌아간다.
  useEffect(() => () => opened.anchor.focus(), [opened.anchor]);
  const close = onClose;
  const works = member.works;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc는 dialog의 cancel이 맡는다
    <dialog
      ref={dialog}
      className="profile-card"
      aria-label={personName(member.name, member.login)}
      style={{ "--x": `${left}px`, "--y": `${top}px` } as React.CSSProperties}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <div className="profile-card-body" data-offline={member.presence === "offline" || undefined}>
        <Identity member={member} />
        {works.length > 0 && (
          <section>
            <Heading>작업 {works.length}개</Heading>
            <WorkList member={member} works={works.slice(0, CARD_WORKS)} direct={direct} />
            {works.length > CARD_WORKS && (
              <button
                type="button"
                className="profile-more"
                onClick={() => {
                  onClose();
                  onFull(member.login);
                }}
              >
                작업 {works.length - CARD_WORKS}개 더
              </button>
            )}
          </section>
        )}
        <button
          type="button"
          className="button outline profile-full"
          onClick={() => {
            onClose();
            onFull(member.login);
          }}
        >
          프로필 전체 보기
        </button>
      </div>
    </dialog>
  );
}

function WorkList({
  member,
  works,
  direct,
}: {
  member: MemberView;
  works: MemberView["works"];
  direct: Set<string>;
}) {
  return (
    <ul className="profile-works">
      {works.map((work) => (
        <WorkItem
          key={work.branch}
          member={member}
          work={work}
          conflict={direct.has(`${member.login}/${work.branch}`)}
        />
      ))}
    </ul>
  );
}

/**
 * 프로필 전체 보기의 몸: 한 목록이다. 사람, 상태 메시지, 작업 전부, 에이전트 전부.
 * 멤버 목록이 바뀌면 이 사람의 것도 그 자리에서 바뀐다(`member`가 매번 새 값이다).
 */
export function ProfileView({ member, direct }: { member: MemberView; direct: Set<string> }) {
  return (
    <div className="profile-view" data-offline={member.presence === "offline" || undefined}>
      <Identity member={member} big />
      <section>
        <Heading>작업 {member.works.length}개</Heading>
        {member.works.length > 0 ? (
          <WorkList member={member} works={member.works} direct={direct} />
        ) : (
          <p className="profile-none">작업 없음</p>
        )}
      </section>
      {member.agents.length > 0 && (
        <section>
          <Heading>에이전트 {member.agents.length}개</Heading>
          <ul className="profile-works">
            {member.agents.map((agent) => (
              <IdleAgent key={agent.executor} member={member} agent={agent} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
