// Tema «minimal» de Chameleon CV (T-8.3): monocromo, sin filetes ni columnas. Mismo contrato que «default»
// (docs/plantillas-typst.md): recibe la StructuredView ya decodificada y el theme.toml validado; no interpreta
// Markdown, no lee ficheros ni importa paquetes. Autocontenido: el `--root` de Typst es este directorio.
//
// Rasgos: un solo color de texto; la jerarquía la dan el tamaño y el peso; títulos de sección en
// mayúsculas pequeñas; cada entrada en una línea («Puesto — Empresa · periodo») seguida de
// viñetas planas; sin tablas, columnas ni fondos, para que los sistemas de filtrado lo lean sin sorpresas.

// ── Estilos derivados del tema ──────────────────────────────────────────────────────────────────
#let styles(theme) = (
  ink: rgb(theme.colors.text),
  primary: rgb(theme.colors.primary),
  muted: rgb(theme.colors.secondary),
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
// Título de sección: mayúsculas pequeñas, sin filete ni espaciado entre letras (el espaciado rompe la
// extracción de texto de los ATS: «E X P E R I E N C I A»).
#let section(s, title) = block(
  above: 1.5em,
  below: 0.6em,
  sticky: true,
  text(font: s.fonts.heading, size: s.sizes.section, weight: "bold", fill: s.primary, upper(title)),
)

// Entrada en una sola línea: título en negrita, periodo y ubicación en gris.
#let entry(s, heading, period, location: none) = block(
  sticky: true,
  above: 0.9em,
  below: 0.3em,
  {
    text(font: s.fonts.heading, size: s.sizes.title, weight: "bold", fill: s.primary)[#heading]
    text(size: s.sizes.meta, fill: s.muted)[ · #period]
    if location != none { text(size: s.sizes.meta, fill: s.muted)[ · #location] }
  },
)

#let technologies(s, label, names) = block(above: 0.4em, text(size: s.sizes.meta, fill: s.muted)[#label: #names])

#let container(s, d, heading, subtitle, item, location: none) = {
  entry(s, heading, subtitle, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(s, a) }
  if item.technologies != "" { technologies(s, d.labels.technologies, item.technologies) }
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
  set list(marker: text(fill: s.muted)[–], indent: 0em, body-indent: 0.6em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show link: underline
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)

  // Cabecera: nombre, titular y contacto, sin adornos.
  block(below: 0.45em, text(font: s.fonts.heading, size: s.sizes.name, weight: "bold", fill: s.primary)[#d.fullName])
  let headline = d.at("headline", default: none)
  if headline != none { block(below: 0.4em, text(size: s.sizes.headline, fill: s.muted)[#headline]) }
  if d.contact.len() > 0 { block(below: 0.9em, text(size: s.sizes.contact, fill: s.muted, runs(d.contact))) }
  if d.summary.len() > 0 { blocks(d.summary) }

  if d.experience.len() > 0 {
    section(s, d.labels.experience)
    for item in d.experience {
      container(s, d, item.role + " — " + item.company, item.period, item, location: item.at("location", default: none))
    }
  }

  if d.projects.len() > 0 {
    section(s, d.labels.projects)
    for item in d.projects {
      let role = item.at("role", default: none)
      let heading = if role != none { item.name + " — " + role } else { item.name }
      container(s, d, heading, item.meta, item)
    }
  }

  if d.skillGroups.len() > 0 {
    section(s, d.labels.skills)
    for g in d.skillGroups { block(below: 0.4em)[#strong(g.label): #g.names] }
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
      block(below: 0.4em)[#strong(degree) — #e.institution #text(fill: s.muted)[· #e.period]]
    }
  }

  if d.certifications.len() > 0 {
    section(s, d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      block(below: 0.4em)[#strong(c.name)#if issuer != none [ — #issuer] #text(fill: s.muted)[· #c.date]#if url != none [ · #link(url)[#d.labels.link]]]
    }
  }

  if d.languages.len() > 0 {
    section(s, d.labels.languages)
    d.languages.map(l => [#strong(l.name): #l.level]).join([ · ])
  }
}
