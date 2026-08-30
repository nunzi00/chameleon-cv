// Tema «awesome» de Chameleon CV (T-8.7): el aspecto de Awesome-CV en una sola columna y sin iconos.
// Recibe la StructuredView (src/renderers/structured) ya decodificada y el tema (theme.toml). No interpreta
// Markdown, no lee ficheros ni importa paquetes: solo maqueta datos. La CLI genera el documento principal:
//   #import "/template.typ": cv
//   #cv(json(bytes("…vista…")), json(bytes("…tema…")))
// Contrato en docs/plantillas-typst.md. Reglas ATS: sin tracking amplio, sin letras espaciadas, sin place().

// ── Estilos derivados del tema ──────────────────────────────────────────────────────────────────
#let styles(theme) = (
  ink: rgb(theme.colors.text),
  primary: rgb(theme.colors.primary),
  muted: rgb(theme.colors.secondary),
  rule: rgb(theme.colors.rule),
  accent: rgb(theme.colors.accent),
  fonts: theme.fonts,
  sizes: (
    name: theme.sizes.name * 1pt,
    headline: theme.sizes.headline * 1pt,
    contact: theme.sizes.contact * 1pt,
    section: theme.sizes.section * 1pt,
    title: theme.sizes.title * 1pt,
    meta: theme.sizes.meta * 1pt,
    body: theme.sizes.body * 1pt,
    footer: theme.sizes.footer * 1pt,
    code: theme.sizes.code * 1pt,
  ),
  spacing: (
    leading: theme.spacing.leading * 1em,
    paragraph: theme.spacing.paragraph * 1em,
    list: theme.spacing.list * 1em,
  ),
  margins: (
    top: theme.page.margins.top * 1mm,
    right: theme.page.margins.right * 1mm,
    bottom: theme.page.margins.bottom * 1mm,
    left: theme.page.margins.left * 1mm,
  ),
  paper: theme.page.paper,
)

// ── Runs y bloques (Markdown ya descompuesto por la CLI) ────────────────────────────────────────
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  let url = r.at("link", default: none)
  if url != none { body = link(url, body) }
  body
}

#let runs(rs) = rs.map(run).join()

#let blocks(bs) = {
  for b in bs {
    if b.runs.len() > 0 {
      if b.bullet { list.item(runs(b.runs)) } else { par(runs(b.runs)) }
    }
  }
}

#let achievement(s, a) = {
  let impact = a.at("impact", default: none)
  let tail = if impact != none { text(fill: s.muted)[ (#impact)] } else { [] }
  list.item(runs(a.runs) + tail)
}

// «periodo · URL» de los proyectos: el periodo va a la derecha y el resto a la celda de ubicación.
#let split-meta(meta) = {
  let parts = meta.split(" · ")
  (period: parts.first(), rest: if parts.len() > 1 { parts.slice(1).join(" · ") } else { none })
}

// ── Piezas de maquetación ───────────────────────────────────────────────────────────────────────
// Título de sección al estilo Awesome-CV: las tres primeras letras en acento, el resto en primario, y un filete
// hasta el margen. Las letras van en el mismo párrafo (pdf.js las lee como una palabra).
#let section(s, title) = {
  let cl = title.clusters()
  let head = cl.slice(0, calc.min(3, cl.len())).join()
  let tail = if cl.len() > 3 { cl.slice(3).join() } else { "" }
  block(
    width: 100%,
    above: 1.3em,
    below: 0.65em,
    sticky: true,
    grid(
      columns: (auto, 1fr),
      column-gutter: 0.7em,
      align: (left + horizon, horizon),
      text(font: s.fonts.heading, size: s.sizes.section, weight: "bold", fill: s.primary)[#text(fill: s.accent)[#head]#tail],
      line(length: 100%, stroke: 0.6pt + s.rule),
    ),
  )
}

// Entrada en rejilla 2×2: puesto | ubicación · empresa | periodo.
#let entry(s, title, subtitle, period, location: none) = {
  let cells = (
    text(font: s.fonts.heading, size: s.sizes.title, weight: "bold", fill: s.primary)[#title],
    text(size: s.sizes.meta, fill: s.accent, style: "italic")[#if location != none [#location]],
    text(size: s.sizes.meta, fill: s.muted)[#smallcaps(subtitle)],
    text(size: s.sizes.meta, fill: s.muted, style: "italic")[#period],
  )
  block(sticky: true, above: 0.95em, below: 0.35em, grid(columns: (1fr, auto), column-gutter: 1.2em, row-gutter: 0.3em, align: (left, right), ..cells))
}

#let technologies(s, label, names) = block(above: 0.45em, text(size: s.sizes.meta, fill: s.muted)[#text(weight: "semibold")[#label:] #names])

#let container(s, d, title, subtitle, period, item, location: none) = {
  entry(s, title, subtitle, period, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(s, a) }
  if item.technologies != "" { technologies(s, d.labels.technologies, item.technologies) }
}

#let row(s, lhs, rhs) = grid(columns: (1fr, auto), column-gutter: 1.2em, align: (left, right), lhs, text(size: s.sizes.meta, fill: s.muted, style: "italic")[#rhs])

// ── Documento ───────────────────────────────────────────────────────────────────────────────────
#let cv(d, theme) = {
  let s = styles(theme)
  set document(title: "CV — " + d.fullName, author: d.fullName)
  set page(
    paper: s.paper,
    margin: s.margins,
    footer: context {
      let total = counter(page).final().first()
      if total > 1 {
        align(center, text(size: s.sizes.footer, fill: s.muted)[#d.fullName · #counter(page).display() / #total])
      }
    },
  )
  set text(font: s.fonts.body, size: s.sizes.body, lang: d.lang, fill: s.ink, hyphenate: false)
  set strong(delta: 200)
  set par(justify: false, leading: s.spacing.leading, spacing: s.spacing.paragraph)
  set list(marker: text(fill: s.muted)[•], indent: 0.1em, body-indent: 0.6em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)

  // Cabecera centrada: nombre de pila en regular y gris, apellidos en negrita; titular en versalitas de acento.
  let parts = d.fullName.split(" ")
  let given = if parts.len() > 1 { parts.slice(0, -1).join(" ") } else { none }
  let family = parts.last()
  align(center)[
    #block(below: 0.35em, text(font: s.fonts.heading, size: s.sizes.name)[#if given != none [#text(weight: "regular", fill: s.muted)[#given] ]#text(weight: "bold", fill: s.primary)[#family]])
    #let headline = d.at("headline", default: none)
    #if headline != none { block(below: 0.45em, text(size: s.sizes.headline, fill: s.accent, tracking: 0.03em, smallcaps(headline))) }
    #if d.contact.len() > 0 { block(below: 0.2em, text(size: s.sizes.contact, fill: s.muted, runs(d.contact))) }
  ]
  if d.summary.len() > 0 { v(0.6em); blocks(d.summary) }

  if d.experience.len() > 0 {
    section(s, d.labels.experience)
    for item in d.experience {
      container(s, d, item.role, item.company, item.period, item, location: item.at("location", default: none))
    }
  }

  if d.projects.len() > 0 {
    section(s, d.labels.projects)
    for item in d.projects {
      let meta = split-meta(item.meta)
      let role = item.at("role", default: none)
      container(s, d, item.name, if role != none { role } else { "" }, meta.period, item, location: meta.rest)
    }
  }

  if d.skillGroups.len() > 0 {
    section(s, d.labels.skills)
    grid(
      columns: (auto, 1fr),
      column-gutter: 1.2em,
      row-gutter: 0.45em,
      ..d.skillGroups.map(g => (text(weight: "semibold", fill: s.primary)[#g.label:], [#g.names])).flatten(),
    )
  }

  if d.achievements.len() > 0 {
    section(s, d.labels.achievements)
    for a in d.achievements { achievement(s, a) }
  }

  if d.education.len() > 0 {
    section(s, d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      entry(s, degree, e.institution, e.period)
    }
  }

  if d.certifications.len() > 0 {
    section(s, d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      let left = [#strong(c.name)#if issuer != none [ · #issuer]#if url != none [ · #link(url)[#d.labels.link]]]
      block(below: 0.45em, row(s, left, c.date))
    }
  }

  if d.languages.len() > 0 {
    section(s, d.labels.languages)
    d.languages.map(l => [#strong(l.name): #l.level]).join([ · ])
  }
}
