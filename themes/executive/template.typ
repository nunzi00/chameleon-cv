// Tema «executive» de Chameleon CV (T-8.7): estilo «banking» para perfiles de dirección. Recibe la StructuredView
// (src/renderers/structured) ya decodificada y el tema (theme.toml). No interpreta Markdown, no lee ficheros ni
// importa paquetes: solo maqueta datos. La CLI genera el documento principal:
//   #import "/template.typ": cv
//   #cv(json(bytes("…vista…")), json(bytes("…tema…")))
// Contrato en docs/plantillas-typst.md. Orden: cabecera · resumen · logros destacados · competencias clave ·
// experiencia · proyectos · formación · certificaciones · idiomas.

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

// Logro con el impacto en negrita tras una raya: el resultado es lo primero que lee un directivo.
#let achievement(s, a) = {
  let impact = a.at("impact", default: none)
  let tail = if impact != none { [ — #strong(impact)] } else { [] }
  list.item(runs(a.runs) + tail)
}

#let split-meta(meta) = {
  let parts = meta.split(" · ")
  (period: parts.first(), rest: if parts.len() > 1 { parts.slice(1).join(" · ") } else { none })
}

// ── Piezas de maquetación ───────────────────────────────────────────────────────────────────────
// Título de sección: sans en mayúsculas pequeñas (sin espaciar letras) sobre un filete fino.
#let section(s, title) = block(
  width: 100%,
  above: 1.3em,
  below: 0.6em,
  sticky: true,
  inset: (bottom: 2.5pt),
  stroke: (bottom: 0.6pt + s.rule),
  text(font: s.fonts.heading, size: s.sizes.section, weight: "semibold", fill: s.primary, tracking: 0.04em, upper(title)),
)

// Entrada tipo banking: empresa en negrita | periodo; puesto en cursiva | ubicación.
#let entry(s, organisation, role, period, location: none) = {
  let cells = (
    text(size: s.sizes.title, weight: "bold", fill: s.primary)[#organisation],
    text(size: s.sizes.meta, fill: s.muted)[#period],
    text(size: s.sizes.title, style: "italic")[#role],
    text(size: s.sizes.meta, fill: s.muted)[#if location != none [#location]],
  )
  block(sticky: true, above: 1em, below: 0.4em, grid(columns: (1fr, auto), column-gutter: 1.2em, row-gutter: 0.3em, align: (left, right), ..cells))
}

#let technologies(s, label, names) = block(above: 0.5em, text(size: s.sizes.meta, fill: s.muted)[#text(weight: "semibold")[#label:] #names])

#let container(s, d, organisation, role, period, item, location: none) = {
  entry(s, organisation, role, period, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(s, a) }
  if item.technologies != "" { technologies(s, d.labels.technologies, item.technologies) }
}

#let row(s, lhs, rhs) = grid(columns: (1fr, auto), column-gutter: 1.2em, align: (left, right), lhs, text(size: s.sizes.meta, fill: s.muted)[#rhs])

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
        align(center, text(size: s.sizes.footer, fill: s.muted)[#d.fullName · #d.labels.page #counter(page).display() #d.labels.of #total])
      }
    },
  )
  set text(font: s.fonts.body, size: s.sizes.body, lang: d.lang, fill: s.ink, hyphenate: false)
  set strong(delta: 200)
  set par(justify: false, leading: s.spacing.leading, spacing: s.spacing.paragraph)
  set list(marker: text(fill: s.muted)[•], indent: 0.1em, body-indent: 0.6em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)

  // Cabecera centrada tipo banking: nombre en serif negrita, titular, contacto y un solo filete.
  align(center)[
    #block(below: 0.3em, text(size: s.sizes.name, weight: "bold", fill: s.primary)[#d.fullName])
    #let headline = d.at("headline", default: none)
    #if headline != none { block(below: 0.4em, text(size: s.sizes.headline, style: "italic", fill: s.muted)[#headline]) }
    #if d.contact.len() > 0 { block(below: 0.2em, text(size: s.sizes.contact, fill: s.muted, runs(d.contact))) }
  ]
  line(length: 100%, stroke: 0.6pt + s.rule)
  if d.summary.len() > 0 { v(0.5em); blocks(d.summary) }

  // Logros destacados arriba, en un bloque con fondo suave y filete de acento a la izquierda.
  if d.achievements.len() > 0 {
    section(s, d.labels.achievements)
    block(
      width: 100%,
      fill: s.rule.lighten(70%),
      stroke: (left: 2pt + s.accent),
      inset: (x: 10pt, y: 8pt),
      radius: 2pt,
      for a in d.achievements { achievement(s, a) },
    )
  }

  // Competencias clave: una fila compacta por categoría.
  if d.skillGroups.len() > 0 {
    section(s, d.labels.skills)
    par(d.skillGroups.map(g => [#strong(g.label): #g.names]).join([ · ]))
  }

  if d.experience.len() > 0 {
    section(s, d.labels.experience)
    for item in d.experience {
      container(s, d, item.company, item.role, item.period, item, location: item.at("location", default: none))
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

  if d.education.len() > 0 {
    section(s, d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      block(below: 0.45em, row(s, [#strong(e.institution) · #degree], e.period))
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
