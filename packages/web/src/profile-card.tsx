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
import { t } from "./i18n.ts";
import { IdleAgent, WorkItem } from "./members.tsx";
import { StatusText } from "./profile.tsx";
import { Avatar, Dot, PRESENCE_WORDS, personName } from "./workspace.tsx";

/** How many works the card shows (DESIGN.md "Profile card"). The rest are under "N more works" in the full view. */
const CARD_WORKS = 2;
const CARD_WIDTH = 320;
const GAP = 8;

/** Where to open the card: the pressed element (where focus returns) and which side of it the card goes. */
export type Opened = { login: string; anchor: HTMLElement; side: "right" | "left" };

/** Filled in by the app frame. `Person` reads the member list and how to open a card from here. */
export const PeopleContext = createContext<{
  members: MemberView[];
  open: (opened: Opened) => void;
}>({ members: [], open: () => {} });

/**
 * Wraps a person's name or avatar so pressing it opens the profile card. People not in the member list (e.g. GitHub commenters) aren't wrapped.
 * `inLink` is for spots inside a link where buttons can't nest (the forum card). It opens by mouse only; keyboard users open it from the member list row.
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
  /** Wraps only the avatar: the name button is beside it, so it's left out of keyboard and screen reader order. */
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
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: inside a link, so no button. Keyboard users open it from the member list row
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

/** Name, login link, presence, status message: the card and the full view share this head. */
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

/** A heading line in the card */
const Heading = ({ children }: { children: ReactNode }) => (
  <h4 className="profile-heading">{children}</h4>
);

/**
 * Profile card: a small card next to where you pressed. It's a modal `<dialog>`, so Esc and pressing outside close it, and it shows over other sheets.
 * On close, focus returns to where you pressed. At 833px and below, CSS turns it into a bottom sheet.
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
  // If it overflows the bottom of the window, move it up to fit.
  useLayoutEffect(() => {
    const height = dialog.current?.offsetHeight ?? 0;
    setTop(Math.max(GAP, Math.min(rect.top, innerHeight - GAP - height)));
  }, [rect.top]);
  // On close (after the dialog is removed), focus returns to where you pressed.
  useEffect(() => () => opened.anchor.focus(), [opened.anchor]);
  const close = onClose;
  const works = member.works;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Esc is handled by the dialog's cancel
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
            <Heading>{t.profile.card.works(works.length)}</Heading>
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
                {t.profile.card.moreWorks(works.length - CARD_WORKS)}
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
          {t.profile.card.viewFull}
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
 * The body of the full profile view: one list. The person, status message, all work, all Agents.
 * When the member list changes, this person's part changes in place (`member` is a new value each time).
 */
export function ProfileView({ member, direct }: { member: MemberView; direct: Set<string> }) {
  return (
    <div className="profile-view" data-offline={member.presence === "offline" || undefined}>
      <Identity member={member} big />
      <section>
        <Heading>{t.profile.card.works(member.works.length)}</Heading>
        {member.works.length > 0 ? (
          <WorkList member={member} works={member.works} direct={direct} />
        ) : (
          <p className="profile-none">{t.profile.card.noWork}</p>
        )}
      </section>
      {member.agents.length > 0 && (
        <section>
          <Heading>{t.profile.card.agents(member.agents.length)}</Heading>
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
