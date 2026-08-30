// Tema «academic» de Chameleon CV (T-8.3): serif, sobrio, de una columna. Mismo contrato que «default»
// (docs/plantillas-typst.md): recibe la StructuredView ya decodificada y el theme.toml validado; no interpreta
// Markdown, no lee ficheros ni importa paquetes. Autocontenido: el `--root` de Typst es este directorio.
//
// Rasgos: cabecera centrada con el nombre en versalitas y un filete; secciones numeradas («1  Experiencia»)
// con filete fino; cada entrada con el periodo al margen izquierdo y el contenido a la derecha; cuerpo
// justificado con partición de palabras; pie con «Nombre · página X de Y» en todas las páginas.

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

// ── Piezas de maquetación ───────────────────────────────────────────────────────────────────────
// Ancho de la columna del margen (periodos) y separación con el contenido.
#let margin-column = 9.5em
#let gutter = 1.3em

// Título de sección numerado sobre un filete fino; nunca queda huérfano al pie de página.
#let section(s, number, title) = block(
  width: 100%,
  above: 1.4em,
  below: 0.7em,
  sticky: true,
  inset: (bottom: 3pt),
  stroke: (bottom: 0.5pt + s.rule),
  text(font: s.fonts.heading, size: s.sizes.section, weight: "bold", fill: s.primary)[#text(fill: s.accent)[#number]#h(0.8em)#title],
)

// Entrada con el periodo al margen y el contenido a la derecha.
#let entry(s, period, body) = block(
  sticky: true,
  above: 0.85em,
  below: 0.3em,
  grid(
    columns: (margin-column, 1fr),
    column-gutter: gutter,
    align: (right, left),
    text(size: s.sizes.meta, fill: s.muted, hyphenate: false)[#period],
    body,
  ),
)

// Contenido alineado con la columna del texto (bajo una entrada).
#let indented(body) = pad(left: margin-column + gutter, body)

#let technologies(s, label, names) = block(above: 0.45em, text(size: s.sizes.meta, fill: s.muted)[#emph(label): #names])

// El `meta` de un proyecto es «periodo · URL» (cualquiera de los dos puede faltar): el periodo va al margen y el resto, como nota.
#let split-meta(meta) = {
  let parts = meta.split(" · ")
  (period: parts.first(), rest: if parts.len() > 1 { parts.slice(1).join(" · ") } else { none })
}

#let container(s, d, heading, subtitle, item, location: none, note: none) = {
  let head = text(font: s.fonts.heading, size: s.sizes.title, weight: "bold", fill: s.primary)[#heading]
  let sub = if location != none { text(size: s.sizes.meta, fill: s.muted)[ · #emph(location)] } else { [] }
  entry(s, subtitle, head + sub)
  indented({
    if note != none { block(below: 0.35em, text(size: s.sizes.meta, fill: s.muted)[#note]) }
    blocks(item.summary)
    for a in item.achievements { achievement(s, a) }
    if item.technologies != "" { technologies(s, d.labels.technologies, item.technologies) }
  })
}

// ── Documento ───────────────────────────────────────────────────────────────────────────────────
#let cv(d, theme) = {
  let s = styles(theme)
  set document(title: "CV — " + d.fullName, author: d.fullName)
  set page(
    paper: s.paper,
    margin: s.margins,
    footer: context {
      let total = counter(page).final().first()
      align(center, text(size: s.sizes.footer, fill: s.muted)[#d.fullName · #d.labels.page #counter(page).display() #d.labels.of #total])
    },
  )
  set text(font: s.fonts.body, size: s.sizes.body, lang: d.lang, fill: s.ink, hyphenate: true)
  set par(justify: true, leading: s.spacing.leading, spacing: s.spacing.paragraph)
  set list(marker: text(fill: s.muted)[–], indent: 0.1em, body-indent: 0.6em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)

  // Cabecera centrada: nombre en versalitas, titular, contacto y un filete.
  align(center, {
    block(below: 0.35em, text(font: s.fonts.heading, size: s.sizes.name, weight: "bold", fill: s.primary, smallcaps(d.fullName)))
    let headline = d.at("headline", default: none)
    if headline != none { block(below: 0.4em, text(size: s.sizes.headline, fill: s.muted, style: "italic")[#headline]) }
    if d.contact.len() > 0 { block(below: 0.5em, text(size: s.sizes.contact, fill: s.muted, runs(d.contact))) }
  })
  line(length: 100%, stroke: 0.6pt + s.rule)
  if d.summary.len() > 0 { v(0.55em); blocks(d.summary) }

  let n = 0

  if d.experience.len() > 0 {
    n += 1
    section(s, str(n), d.labels.experience)
    for item in d.experience {
      container(s, d, item.role + " · " + item.company, item.period, item, location: item.at("location", default: none))
    }
  }

  if d.projects.len() > 0 {
    n += 1
    section(s, str(n), d.labels.projects)
    for item in d.projects {
      let role = item.at("role", default: none)
      let heading = if role != none { item.name + " · " + role } else { item.name }
      let meta = split-meta(item.meta)
      container(s, d, heading, meta.period, item, note: meta.rest)
    }
  }

  if d.education.len() > 0 {
    n += 1
    section(s, str(n), d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      entry(s, e.period, [#strong(degree) · #e.institution])
    }
  }

  if d.skillGroups.len() > 0 {
    n += 1
    section(s, str(n), d.labels.skills)
    for g in d.skillGroups { entry(s, g.label, [#g.names]) }
  }

  if d.achievements.len() > 0 {
    n += 1
    section(s, str(n), d.labels.achievements)
    indented({ for a in d.achievements { achievement(s, a) } })
  }

  if d.certifications.len() > 0 {
    n += 1
    section(s, str(n), d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      entry(s, c.date, [#strong(c.name)#if issuer != none [ · #issuer]#if url != none [ · #link(url)[#d.labels.link]]])
    }
  }

  if d.languages.len() > 0 {
    n += 1
    section(s, str(n), d.labels.languages)
    entry(s, [], d.languages.map(l => [#strong(l.name): #l.level]).join([ · ]))
  }
}
