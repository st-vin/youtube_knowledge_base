import obsidianmd from "eslint-plugin-obsidianmd";

export default [
  ...obsidianmd.configs.recommended,
  {
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        brands: ["YouTube", "GitHub", "AI", "LLM", "API"],
        acronyms: ["URL", "HTML", "MOC", "ID"],
      }],
    },
  },
];
