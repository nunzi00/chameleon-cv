// Tema «modern» de Chameleon CV (T-8.3): contemporáneo. Mismo contrato que «default» (docs/plantillas-typst.md):
// recibe la StructuredView ya decodificada y el theme.toml validado; no interpreta Markdown, no lee ficheros ni
// importa paquetes. Autocontenido: el `--root` de Typst es este directorio.
//
// Rasgos: franja de color de acento en la cabecera con el nombre en blanco; columna lateral (contacto,
// skills, idiomas, certificaciones y logros transversales) junto a la columna principal (resumen, experiencia,
// proyectos y formación); títulos de sección con una marca de acento a la izquierda; periodos en pastillas.

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
// Pastilla: fondo suave y esquinas redondeadas, para periodos y etiquetas.
#let pill(s, body) = box(
  fill: s.rule.lighten(40%),
  inset: (x: 0.5em, y: 0.2em),
  radius: 0.35em,
  baseline: 0.2em,
  text(size: s.sizes.meta, fill: s.muted, body),
)

// Título de sección: marca de acento a la izquierda y título en el color primario.
#let section(s, title) = block(
  width: 100%,
  above: 1.2em,
  below: 0.55em,
  sticky: true,
  grid(
    columns: (0.28em, auto),
    column-gutter: 0.55em,
    align: horizon,
    rect(width: 0.28em, height: 0.95em, fill: s.accent, radius: 0.1em),
    text(font: s.fonts.heading, size: s.sizes.section, weight: "bold", fill: s.primary, tracking: 0.04em, upper(title)),
  ),
)

// Título de sección de la columna lateral: más pequeño, en el color de acento.
#let side-section(s, title) = block(
  above: 1.1em,
  below: 0.45em,
  sticky: true,
  text(font: s.fonts.heading, size: s.sizes.meta, weight: "bold", fill: s.accent, tracking: 0.08em, upper(title)),
)

// Cabecera de entrada: título a la izquierda, periodo en pastilla a la derecha; ubicación (o URL) debajo.
#let entry(s, heading, period, location: none) = {
  block(
    sticky: true,
    above: 0.9em,
    below: 0.35em,
    grid(
      columns: (1fr, auto),
      column-gutter: 1em,
      align: (left, right),
      text(font: s.fonts.heading, size: s.sizes.title, weight: "semibold", fill: s.primary)[#heading],
      if period != "" { pill(s, period) } else { [] },
    ),
  )
  if location != none { block(above: 0em, below: 0.35em, text(size: s.sizes.meta, fill: s.muted, style: "italic")[#location]) }
}

#let technologies(s, label, names) = block(above: 0.45em, text(size: s.sizes.meta, fill: s.muted)[#text(weight: "semibold")[#label:] #names])

// El `meta` de un proyecto es «periodo · URL» (cualquiera de los dos puede faltar): el periodo va a la pastilla y el resto debajo.
#let split-meta(meta) = {
  let parts = meta.split(" · ")
  (period: parts.first(), rest: if parts.len() > 1 { parts.slice(1).join(" · ") } else { none })
}

#let container(s, d, heading, subtitle, item, location: none) = {
  entry(s, heading, subtitle, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(s, a) }
  if item.technologies != "" { technologies(s, d.labels.technologies, item.technologies) }
}

// ── Columna lateral ─────────────────────────────────────────────────────────────────────────────
#let sidebar(s, d) = {
  set text(size: s.sizes.contact)
  set par(leading: s.spacing.leading)
  if d.contact.len() > 0 {
    side-section(s, d.labels.contact)
    text(fill: s.muted, runs(d.contact))
  }
  if d.skillGroups.len() > 0 {
    side-section(s, d.labels.skills)
    for g in d.skillGroups {
      block(below: 0.4em)[#text(weight: "semibold", fill: s.primary)[#g.label] \ #text(fill: s.muted)[#g.names]]
    }
  }
  if d.languages.len() > 0 {
    side-section(s, d.labels.languages)
    for l in d.languages { block(below: 0.25em)[#strong(l.name) #text(fill: s.muted)[· #l.level]] }
  }
  if d.certifications.len() > 0 {
    side-section(s, d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      block(below: 0.35em)[#strong(c.name)#if issuer != none [ · #issuer] \ #text(fill: s.muted)[#c.date#if url != none [ · #link(url)[#d.labels.link]]]]
    }
  }
  if d.achievements.len() > 0 {
    side-section(s, d.labels.achievements)
    for a in d.achievements { achievement(s, a) }
  }
}

// ── Columna principal ───────────────────────────────────────────────────────────────────────────
#let main(s, d) = {
  if d.summary.len() > 0 { blocks(d.summary) }

  if d.experience.len() > 0 {
    section(s, d.labels.experience)
    for item in d.experience {
      container(s, d, item.role + " · " + item.company, item.period, item, location: item.at("location", default: none))
    }
  }

  if d.projects.len() > 0 {
    section(s, d.labels.projects)
    for item in d.projects {
      let role = item.at("role", default: none)
      let heading = if role != none { item.name + " · " + role } else { item.name }
      let meta = split-meta(item.meta)
      container(s, d, heading, meta.period, item, location: meta.rest)
    }
  }

  if d.education.len() > 0 {
    section(s, d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      block(below: 0.45em, grid(columns: (1fr, auto), column-gutter: 1em, align: (left, right), [#strong(degree) · #e.institution], pill(s, e.period)))
    }
  }
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
      if total > 1 {
        align(center, text(size: s.sizes.footer, fill: s.muted)[#d.fullName · #counter(page).display() / #total])
      }
    },
  )
  set text(font: s.fonts.body, size: s.sizes.body, lang: d.lang, fill: s.ink, hyphenate: false)
  set strong(delta: 200)
  set par(justify: false, leading: s.spacing.leading, spacing: s.spacing.paragraph)
  set list(marker: text(fill: s.accent)[▸], indent: 0.1em, body-indent: 0.55em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)

  // Cabecera: franja de acento con el nombre y el titular en blanco.
  block(
    width: 100%,
    fill: s.accent,
    inset: (x: 1.1em, y: 0.9em),
    radius: 0.3em,
    below: 1.1em,
    {
      text(font: s.fonts.heading, size: s.sizes.name, weight: "bold", fill: white, tracking: -0.01em)[#d.fullName]
      let headline = d.at("headline", default: none)
      if headline != none { linebreak(); text(size: s.sizes.headline, fill: white.darken(8%))[#headline] }
    },
  )

  grid(
    columns: (0.34fr, 0.66fr),
    column-gutter: 1.6em,
    sidebar(s, d),
    main(s, d),
  )
}
