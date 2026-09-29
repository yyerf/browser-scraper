const params = new URLSearchParams(location.search)
const mode = params.get("mode") ?? "next"
const changed = params.get("mutation") === "wrapper"
const dynamic = params.get("mutation") === "dynamic"
const decoy = params.get("mutation") === "decoy"
const recordMutation = params.get("mutation") === "record"
let page = Math.max(1, Math.min(3, Number(params.get("page") ?? 1)))
const app = document.getElementById("app")
if (!app) throw new Error("Fixture root missing")

document.head.insertAdjacentHTML(
  "beforeend",
  `<style>
  body{font:14px system-ui;background:#f8fafc;color:#172033;margin:24px} h1{margin:0 0 8px}
  .catalog{display:grid;grid-template-columns:repeat(4,minmax(160px,1fr));gap:12px;max-width:1100px}
  article,.catalog-item{background:white;border:1px solid #dbe3ee;border-radius:8px;padding:12px;min-height:135px}
  article img,.catalog-item img{width:36px;height:36px;display:block;margin-bottom:8px} article h2,.catalog-item h2{font-size:15px;margin:0 0 7px}
  .price,.current-price{font-weight:700}.rating{display:block;margin-top:7px;color:#64748b}
  nav{padding:20px 0}nav a,button{padding:8px 12px;border:1px solid #cbd5e1;background:white;border-radius:6px;margin-right:6px;cursor:pointer}
  .nested-scroll{height:360px;overflow:auto;border:2px solid #cbd5e1;padding:12px;max-width:1100px}
</style>`,
)

function product(id: number): string {
  const className = dynamic
    ? `css-${Number(params.get("seed") ?? 1).toString(36)}${id.toString(36).padStart(7, "0")}`
    : recordMutation
      ? "catalog-item"
      : "product-card"
  const price = `<span class="${changed ? "current-price" : "price"}" ${changed ? "" : "itemprop='price'"}>$${100 + id - 1}</span>`
  const image = `<img alt="Product ${id}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36'%3E%3Crect width='36' height='36' fill='%237695b5'/%3E%3C/svg%3E">`
  const tag = recordMutation ? "div" : "article"
  return `<${tag} class="${className}" ${recordMutation ? "" : 'data-testid="product-card"'} data-id="${id}">${image}<h2 class="name" itemprop="name">Product ${id}</h2>${decoy ? `<s class="old-price">$${500 + id}</s>` : ""}${changed ? `<div class="new-wrapper">${price}</div>` : price}<span class="rating">${(4 + id / 100).toFixed(2)}</span></${tag}>`
}

function cards(pageNumber: number): string {
  const start = (pageNumber - 1) * 20 + 1
  return Array.from({ length: 20 }, (_, offset) =>
    product(
      mode === "duplicate" && pageNumber > 1 && offset < 5 ? start - 20 + offset : start + offset,
    ),
  ).join("")
}

function pagination(): string {
  if (mode === "static" || mode === "shadow" || mode === "nested" || mode === "infinite") return ""
  if (mode === "load-more") return `<button id="load-more">Load More</button>`
  if (page >= 3) return ""
  if (mode === "numbered")
    return `<nav aria-label="Pages">${[1, 2, 3]
      .map(
        (value) =>
          `<a href="/?mode=numbered&page=${value}" ${value === page ? "aria-current='page'" : ""}>${value}</a>`,
      )
      .join("")}</nav>`
  return `<nav aria-label="Pages"><a rel="next" href="/?mode=${mode}&page=${page + 1}${changed ? "&mutation=wrapper" : recordMutation ? "&mutation=record" : ""}">Next</a></nav>`
}

function render(): void {
  const content = `<p>Fixture: ${mode}; page ${page} of 3.</p><section class="catalog">${cards(page)}</section>${pagination()}`
  app.innerHTML = `<h1>Catalog test fixture</h1>${mode === "nested" ? `<div class="nested-scroll">${content}</div>` : mode === "shadow" ? "<div id='shadow-host'></div>" : content}`
  if (mode === "shadow") {
    const host = document.querySelector("#shadow-host")
    if (!host) throw new Error("Shadow fixture host missing")
    host.attachShadow({
      mode: "open",
    }).innerHTML = `<style>.catalog{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;max-width:1100px}article{border:1px solid #ccd6e4;padding:12px}img{width:36px;display:block}h2{font-size:15px}</style><section class="catalog">${cards(1)}</section>`
  }
  if (mode === "load-more") {
    app.querySelector("#load-more")?.addEventListener("click", () => {
      if (page >= 3) return
      page++
      app.querySelector(".catalog")?.insertAdjacentHTML("beforeend", cards(page))
      if (page >= 3) app.querySelector("#load-more")?.remove()
    })
  }
  if (mode === "spa") {
    app.querySelector("nav a")?.addEventListener("click", (event) => {
      event.preventDefault()
      page++
      history.pushState({ page }, "", `/?mode=spa&page=${page}`)
      render()
    })
  }
  if (mode === "infinite") {
    window.onscroll = () => {
      if (
        page < 3 &&
        window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 100
      ) {
        page++
        app.querySelector(".catalog")?.insertAdjacentHTML("beforeend", cards(page))
      }
    }
  }
}

window.onpopstate = () => {
  page = Math.max(1, Number(new URLSearchParams(location.search).get("page") ?? 1))
  render()
}
render()
