export const CURRENT_AGENTS_DIR = ".agents";

export const SUPPORTED_SKILLS_SUBDIRS = {
    enabled: "skills",
    disabled: "disabled_skills",
} as const;

export type SupportedSkillsSubdirKind = keyof typeof SUPPORTED_SKILLS_SUBDIRS;
export type SupportedSkillsSubdir = (typeof SUPPORTED_SKILLS_SUBDIRS)[SupportedSkillsSubdirKind];

export const LOCAL_SKILLS_DIR = `${CURRENT_AGENTS_DIR}/${SUPPORTED_SKILLS_SUBDIRS.enabled}`;
export const LOCAL_DISABLED_SKILLS_DIR = `${CURRENT_AGENTS_DIR}/${SUPPORTED_SKILLS_SUBDIRS.disabled}`;

export const GLOBAL_AGENTS_DIRS = {
    default: "~/.agents",
    codex: "~/.codex",
    claude: "~/.claude",
    gemini: "~/.gemini",
    antigravity: "~/.gemini/antigravity",
    pi: "~/.pi/agent",
    openode: "~/.config/openode",
} as const;

export type AgentName = keyof typeof GLOBAL_AGENTS_DIRS;

export const AGENT_NAMES = Object.keys(GLOBAL_AGENTS_DIRS) as AgentName[];

export function agentSkillsDir(
    agentName: AgentName,
    subdir: SupportedSkillsSubdirKind = "enabled",
): string {
    return `${GLOBAL_AGENTS_DIRS[agentName]}/${SUPPORTED_SKILLS_SUBDIRS[subdir]}`;
}

function agentSkillDirs(subdir: SupportedSkillsSubdirKind): Record<AgentName, string> {
    return Object.fromEntries(
        AGENT_NAMES.map((agentName) => [agentName, agentSkillsDir(agentName, subdir)]),
    ) as Record<AgentName, string>;
}

export const AGENT_SKILLS_DIRS = agentSkillDirs("enabled");
export const AGENT_DISABLED_SKILLS_DIRS = agentSkillDirs("disabled");

export const AGENT_SKILLS_DIR_LIST = AGENT_NAMES.map((agentName) => AGENT_SKILLS_DIRS[agentName]);
export const AGENT_DISABLED_SKILLS_DIR_LIST = AGENT_NAMES.map(
    (agentName) => AGENT_DISABLED_SKILLS_DIRS[agentName],
);

export function agentSkillLocationName(
    agentName: AgentName,
    subdir: SupportedSkillsSubdirKind = "enabled",
): string {
    return subdir === "enabled" ? `agent:${agentName}` : `agent:${agentName}:${subdir}`;
}
