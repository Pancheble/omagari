import { EXECUTOR_NAMES, type ExecutorId, type MemberView } from "@omagari/contract";
import { Clock } from "lucide-react";
import { type ComponentProps, use, useEffect, useReducer } from "react";
import { ago, language, t } from "./i18n.ts";
import { StatusText } from "./profile.tsx";
import { PeopleContext } from "./profile-card.tsx";
import { Avatar, PRESENCE_WORDS, personName } from "./workspace.tsx";

/** Executor abbreviations for the Agent mark (DESIGN.md "Agent mark"). */
const MARKS = { "claude-code": "CC", codex: "CX" } as const satisfies Record<ExecutorId, string>;

type Member = MemberView;
type Agent = Member["agents"][number];
type Work = Member["works"][number];

/** Is the person offline (presence)? Separate from whether an Agent's Runner is connected. The groups and the dimmed avatar follow this. */
const offline = (member: Member) => member.presence === "offline";

/**
 * Member list: people rows grouped as "Online — N" and "Offline — N". Away and Do not disturb count as online.
 * Rows don't expand; pressing one opens the profile card (DESIGN.md "Member list").
 */
export function MemberList({
  me,
  members,
  cardOf,
}: {
  me: string;
  members: Member[];
  /** The person whose profile card is open (their row is highlighted) */
  cardOf?: string;
}) {
  useMinuteTick();
  const groups = [
    [t.channels.presence.online, members.filter((member) => !offline(member))],
    [t.channels.presence.offline, members.filter(offline)],
  ] as const;
  return groups.map(
    ([title, group]) =>
      group.length > 0 && (
        <section key={title} className="member-group">
          <h3 className="section-title">
            {title} — {group.length}
          </h3>
          <ul>
            {group.map((member) => (
              <MemberRow
                key={member.login}
                member={member}
                me={member.login === me}
                selected={member.login === cardOf}
              />
            ))}
          </ul>
        </section>
      ),
  );
}

/** Loading: an avatar circle and two lines, three people' worth. Same part as the message skeleton. */
export const MemberSkeleton = () => (
  <div
    className="member-skeleton"
    role="status"
    aria-busy="true"
    aria-label={t.profile.members.loading}
  >
    {[0, 1, 2].map((key) => (
      <div key={key} className="skeleton-row" aria-hidden>
        <span className="bone circle" />
        <span className="bones">
          <span className="bone" />
          <span className="bone" />
        </span>
      </div>
    ))}
  </div>
);

function MemberRow({ member, me, selected }: { member: Member; me: boolean; selected: boolean }) {
  const { open } = use(PeopleContext);
  const count = member.works.length;
  const away = offline(member);
  // Second line: status message · N works. With no status message, the presence (other than online) goes there in secondary text,
  // and with neither, just the work count. If the message is long, only the message is cut.
  // While an Agent answers a Q&A, "Answering" goes before the work count (PRD 17). With several Agents, say which one.
  const answering = member.agents
    .filter((agent) => agent.state === "answering")
    .map((agent) =>
      member.agents.length > 1
        ? t.profile.members.answeringBy(EXECUTOR_NAMES[agent.executor])
        : t.profile.members.answering,
    );
  const word = member.presence === "online" ? undefined : PRESENCE_WORDS[member.presence];
  const status = member.message !== null || member.emoji !== null;
  const rest = [!status && word, ...answering, t.profile.members.works(count)]
    .filter(Boolean)
    .join(" · ");
  return (
    <li className="member" data-open={selected || undefined} data-offline={away || undefined}>
      {/* The row doesn't expand; the profile card opens to its left. Work and Agents are in the card and the full view. */}
      <button
        type="button"
        className="member-row"
        aria-haspopup="dialog"
        onClick={(event) =>
          open({ login: member.login, anchor: event.currentTarget, side: "left" })
        }
      >
        <Avatar name={member.name} login={member.login} size={40} presence={member.presence} />
        <span className="member-names">
          <strong>
            <span className="member-name">{personName(member.name, member.login)}</span>
            {me && <span className="me">{t.profile.members.you}</span>}
          </strong>
          <span className="member-status">
            {status && (
              <span className="status-message">
                <StatusText {...member} />
              </span>
            )}
            <span className="status-rest">{status ? `\u00a0· ${rest}` : rest}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

/** One work: Agent mark, status line (chosen in ADR-0010), branch and when it was written, and "As of 3 hours ago" if offline. */
export function WorkItem({
  member,
  work,
  conflict,
}: {
  member: Member;
  work: Work;
  conflict?: boolean;
}) {
  const agent = member.agents.find((candidate) => candidate.executor === work.executor);
  const { line } = work;
  return (
    <li className="work">
      {/* A work with no known Agent goes right under the person (ADR-0015). The line is indented to match the mark. */}
      {agent ? <AgentMark name={member.name} agent={agent} /> : <span className="agent-space" />}
      <div className="work-body">
        <p className={line ? "work-line" : "work-line none"}>
          {!line
            ? t.profile.members.noStatusLine
            : line.source === "files"
              ? t.profile.members.editing(line.file, line.more)
              : line.text}
        </p>
        <p className="work-meta">
          <span className="branch">{work.branch}</span>
          {conflict && <span className="badge warning">{t.alertKinds.direct}</span>}
          {work.broken && <span className="badge warning">{t.profile.members.broken}</span>}
          {line?.source === "agent" && (
            <time dateTime={line.at} title={new Date(line.at).toLocaleString(language)}>
              · {ago(line.at)}
            </time>
          )}
          {line?.source === "pull" && <span>· {t.profile.members.draftPr}</span>}
          {member.offlineSince && (
            <span className="badge outline">
              <Clock size={11} aria-hidden />
              {t.profile.members.asOf(ago(member.offlineSince))}
            </span>
          )}
        </p>
      </div>
    </li>
  );
}

/** One line for an Agent with no work: mark, "Jieun's Claude Code", and its state (same words as the Agent menu in the DM). */
export function IdleAgent({ member, agent }: { member: Member; agent: Agent }) {
  const busy = agent.state === "answering";
  return (
    <li className="work idle-agent">
      <AgentMark name={member.name} agent={agent} />
      <span className="agent-name">
        {t.profile.members.agentOf(member.name, EXECUTOR_NAMES[agent.executor])}
      </span>
      <span className={busy ? "agent-state busy" : "agent-state"}>
        {busy
          ? t.profile.members.answeringDots
          : agent.state === "offline"
            ? t.profile.members.runnerOff
            : t.profile.members.resting}
      </span>
    </li>
  );
}

/** Agent mark: the executor abbreviation and a dot for whether the Runner is connected (green circle if so, empty ring if not). */
function AgentMark({ name, agent }: { name: string; agent: Agent }) {
  const label = t.profile.members.agentLabel(
    name,
    EXECUTOR_NAMES[agent.executor],
    t.profile.members.agentStates[agent.state],
  );
  return <Mark agent={agent} role="img" aria-label={label} title={label} />;
}

/** Just the shape of the Agent mark. Where the name is right beside it, use it with `aria-hidden`. */
export const Mark = ({
  agent,
  ...rest
}: { agent: Pick<Agent, "executor" | "state"> } & ComponentProps<"span">) => (
  <span className="agent-mark" data-state={agent.state} {...rest}>
    {MARKS[agent.executor]}
  </span>
);

/** Redraws every minute so "3m ago" keeps moving. */
function useMinuteTick() {
  const [, tick] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
}
