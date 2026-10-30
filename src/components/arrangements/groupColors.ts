export interface GroupColor {
  background: string;
  border: string;
  text: string;
}

const colors: Record<string, GroupColor> = {
  verse: {
    background: "#263b36",
    border: "#54796b",
    text: "#b5d8c8",
  },
  chorus: {
    background: "#42334b",
    border: "#80618e",
    text: "#e4c9f0",
  },
  bridge: {
    background: "#493c27",
    border: "#94764a",
    text: "#e9d7ae",
  },
  prechorus: {
    background: "#283b50",
    border: "#527da5",
    text: "#c1dcf5",
  },
  intro: {
    background: "#34343d",
    border: "#696978",
    text: "#d1d1dc",
  },
  outro: {
    background: "#493039",
    border: "#92566b",
    text: "#f0c5d3",
  },
  instrumental: {
    background: "#263e42",
    border: "#4e8187",
    text: "#bce1e3",
  },
  default: {
    background: "#303039",
    border: "#626270",
    text: "#d0d0dc",
  },
};

export function getGroupColor(name: string): GroupColor {
  const normalized = name
    .toLowerCase()
    .replace(/[\s_-]+\d+$/, "")
    .replace(/[\s_-]/g, "");

  return colors[normalized] ?? colors.default;
}
