const input = document.querySelector("#search"),
  sections = [...document.querySelectorAll("[data-guide]")],
  status = document.querySelector("#search-status");
input.addEventListener("input", () => {
  const q = input.value.trim().toLowerCase();
  let count = 0;
  for (const s of sections) {
    s.hidden = !!q && !s.textContent.toLowerCase().includes(q);
    if (!s.hidden) count++;
  }
  status.textContent = q ? `${count}件の章が見つかりました` : "";
});
document.querySelectorAll("nav a").forEach((a) =>
  a.addEventListener("click", () => {
    input.value = "";
    sections.forEach((s) => (s.hidden = false));
    status.textContent = "";
  }),
);
