export const LOCAL_SKILLS_DIR = ".agents/skills";
export const LOCAL_DISABLED_SKILLS_DIR = ".agents/disabled_skills";

export const AGENT_SKILLS_DIRS = {
    default: "~/.agents/skills",
    codex: "~/.codex/skills",
    claude: "~/.claude/skills",
    gemini: "~/.gemini/skills",
    antigravity: "~/.gemini/antigravity/skills",
    pi: "~/.pi/agent/skills",
    openode: "~/.config/openode/skills",
} as const;

export type AgentName = keyof typeof AGENT_SKILLS_DIRS;

export const AGENT_NAMES = Object.keys(AGENT_SKILLS_DIRS) as AgentName[];

export const AGENT_SKILLS_DIR_LIST = AGENT_NAMES.map((agentName) => AGENT_SKILLS_DIRS[agentName]);
