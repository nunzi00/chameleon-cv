// Tema «project-portfolio» de Chameleon CV (T-8.12, organización): los proyectos como protagonistas. Cada proyecto es
// una tarjeta con su papel, periodo o enlace, resumen, logros y tecnologías en etiquetas; la experiencia queda en una
// línea por puesto y después van habilidades, logros, formación, certificaciones e idiomas. Para freelance, producto,
// diseño, investigación o quien se presenta por lo que ha construido.
// Recibe la StructuredView (src/renderers/structured) ya decodificada —el Markdown en línea llega como «runs» y
// los párrafos y listas como «blocks»— y el tema (theme.toml validado por la CLI). No interpreta Markdown, no lee
// ficheros ni importa paquetes: solo maqueta datos. La CLI genera el documento principal:
//   #import "/template.typ": cv
//   #cv(json(bytes("…vista…")), json(bytes("…tema…")))
// Para personalizar: `cv theme create mio --from project-portfolio` y edita theme.toml o template.typ (contrato en
// docs/plantillas-typst.md).

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

// Logro como viñeta; «suffix» añade el origen (la empresa) cuando los logros se consolidan fuera de su puesto y «tail»
// permite cerrar la viñeta con una marca (los recortes de «one-page»).
#let achievement(s, a, suffix: none, tail: none) = {
  let impact = a.at("impact", default: none)
  let note = if impact != none { text(fill: s.muted)[ (#impact)] } else { [] }
  let origin = if suffix != none { text(fill: s.muted, size: s.sizes.meta)[ — #suffix] } else { [] }
  list.item(runs(a.runs) + note + origin + (if tail != none { tail } else { [] }))
}

// ── Piezas de maquetación ───────────────────────────────────────────────────────────────────────
// Título de sección: versalitas espaciadas sobre una regla fina. Nunca queda huérfano al pie de página.
#let section(s, title) = block(
  width: 100%,
  above: 1.25em,
  below: 0.6em,
  sticky: true,
  inset: (bottom: 2.5pt),
  stroke: (bottom: 0.5pt + s.rule),
  text(font: s.fonts.heading, size: s.sizes.section, weight: "semibold", fill: s.muted, tracking: 0.09em, smallcaps(title)),
)

// Cabecera de entrada: título a la izquierda, periodo a la derecha; ubicación debajo si la hay.
#let entry(s, heading, period, location: none) = {
  let cells = (
    text(font: s.fonts.heading, size: s.sizes.title, weight: "semibold", fill: s.primary)[#heading],
    text(size: s.sizes.meta, fill: s.muted)[#period],
  )
  if location != none {
    cells.push(text(size: s.sizes.meta, fill: s.muted, style: "italic")[#location])
    cells.push([])
  }
  block(sticky: true, above: 0.95em, below: 0.4em, grid(columns: (1fr, auto), column-gutter: 1.2em, row-gutter: 0.4em, align: (left, right), ..cells))
}

#let technologies(s, label, names) = block(above: 0.5em, text(size: s.sizes.meta, fill: s.muted)[#text(weight: "semibold")[#label:] #names])

// Entrada completa (puesto o proyecto): cabecera, resumen, logros y tecnologías.
#let container(s, d, heading, subtitle, item, location: none) = {
  entry(s, heading, subtitle, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(s, a) }
  if item.technologies != "" { technologies(s, d.labels.technologies, item.technologies) }
}

// Fila «etiqueta: valor» con el valor alineado (formación, certificaciones).
#let row(s, lhs, rhs) = grid(columns: (1fr, auto), column-gutter: 1.2em, align: (left, right), lhs, text(size: s.sizes.meta, fill: s.muted)[#rhs])

// Fila con el periodo en una columna fija a la izquierda: el eje temporal se lee de arriba abajo.
#let dated(s, period, body) = block(
  width: 100%,
  above: 0.9em,
  below: 0.35em,
  breakable: true,
  grid(columns: (8.6em, 1fr), column-gutter: 1.1em, align: (left, left), text(size: s.sizes.meta, fill: s.muted, weight: "semibold")[#period], body),
)

// Título de entrada en una línea: título · subtítulo · (ubicación).
#let headline-of(s, title, subtitle, location: none) = {
  let parts = (text(font: s.fonts.heading, size: s.sizes.title, weight: "semibold", fill: s.primary)[#title],)
  if subtitle != none { parts.push(text(size: s.sizes.title)[#subtitle]) }
  if location != none { parts.push(text(size: s.sizes.meta, fill: s.muted, style: "italic")[#location]) }
  block(sticky: true, below: 0.3em, parts.join([ · ]))
}

// Formación, certificaciones e idiomas: iguales en todas las organizaciones.
#let education(s, d) = {
  if d.education.len() > 0 {
    section(s, d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      block(below: 0.45em, row(s, [#strong(degree) · #e.institution], e.period))
    }
  }
}

#let certifications(s, d) = {
  if d.certifications.len() > 0 {
    section(s, d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      let left = [#strong(c.name)#if issuer != none [ · #issuer]#if url != none [ · #link(url)[#d.labels.link]]]
      block(below: 0.45em, row(s, left, c.date))
    }
  }
}

#let languages(s, d) = {
  if d.languages.len() > 0 {
    section(s, d.labels.languages)
    d.languages.map(l => [#strong(l.name): #l.level]).join([ · ])
  }
}

#let skills-grid(s, d) = grid(
  columns: (auto, 1fr),
  column-gutter: 1.2em,
  row-gutter: 0.45em,
  ..d.skillGroups.map(g => (text(weight: "semibold")[#g.label:], [#g.names])).flatten(),
)

// ── Documento ───────────────────────────────────────────────────────────────────────────────────
#let setup(s, d, body, footer: true) = {
  set document(title: "CV — " + d.fullName, author: d.fullName)
  set page(
    paper: s.paper,
    margin: s.margins,
    footer: context {
      let total = counter(page).final().first()
      if footer and total > 1 {
        align(center, text(size: s.sizes.footer, fill: s.muted)[#d.fullName · #counter(page).display() / #total])
      }
    },
  )
  set text(font: s.fonts.body, size: s.sizes.body, lang: d.lang, fill: s.ink, hyphenate: false)
  set strong(delta: 200) // Regular (400) → Semibold (600): las tres caras embebidas en templates/fonts
  set par(justify: false, leading: s.spacing.leading, spacing: s.spacing.paragraph)
  set list(marker: text(fill: s.muted)[•], indent: 0.1em, body-indent: 0.6em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)
  body
}

#let header(s, d) = {
  block(below: 8pt, text(font: s.fonts.heading, size: s.sizes.name, weight: "semibold", fill: s.primary, tracking: -0.01em)[#d.fullName])
  let headline = d.at("headline", default: none)
  if headline != none { block(below: 0.45em, text(size: s.sizes.headline, fill: s.muted)[#headline]) }
  if d.contact.len() > 0 { block(below: 0.7em, text(size: s.sizes.contact, fill: s.muted, runs(d.contact))) }
  line(length: 100%, stroke: 0.7pt + s.rule)
  if d.summary.len() > 0 { v(0.5em); blocks(d.summary) }
}

// Etiquetas de tecnologías: cajas en línea (texto extraíble, sin iconos).
#let pill(s, t) = box(fill: s.rule.lighten(55%), radius: 3pt, inset: (x: 4.5pt, y: 2pt), baseline: 20%, text(size: s.sizes.code, fill: s.ink)[#t])
#let pills(s, names) = names.split(",").map(n => pill(s, n.trim())).join(h(3.5pt))

#let card(s, d, item) = {
  let role = item.at("role", default: none)
  block(width: 100%, above: 0.8em, below: 0.4em, inset: 9pt, radius: 4pt, stroke: 0.5pt + s.rule, breakable: true, {
    grid(
      columns: (1fr, auto),
      column-gutter: 1em,
      align: (left, right),
      text(font: s.fonts.heading, size: s.sizes.title, weight: "semibold", fill: s.primary)[#item.name#if role != none [ #text(weight: "regular", fill: s.muted)[· #role]]],
      text(size: s.sizes.meta, fill: s.muted)[#item.meta],
    )
    blocks(item.summary)
    for a in item.achievements { achievement(s, a) }
    if item.technologies != "" { v(0.35em); pills(s, item.technologies) }
  })
}

#let cv(d, theme) = {
  let s = styles(theme)
  setup(s, d, {
    header(s, d)

    if d.projects.len() > 0 {
      section(s, d.labels.projects)
      for item in d.projects { card(s, d, item) }
    }

    // Experiencia en una línea por puesto: periodo, puesto, empresa y ubicación; las tecnologías debajo, en gris.
    if d.experience.len() > 0 {
      section(s, d.labels.experience)
      for item in d.experience {
        let location = item.at("location", default: none)
        dated(s, item.period, {
          block(below: 0.2em, [#strong(item.role) · #item.company#if location != none [ #text(size: s.sizes.meta, fill: s.muted, style: "italic")[· #location]]])
          if item.technologies != "" { text(size: s.sizes.meta, fill: s.muted)[#item.technologies] }
        })
      }
    }

    if d.skillGroups.len() > 0 {
      section(s, d.labels.skills)
      skills-grid(s, d)
    }

    if d.achievements.len() > 0 {
      section(s, d.labels.achievements)
      for a in d.achievements { achievement(s, a) }
    }

    education(s, d)
    certifications(s, d)
    languages(s, d)
  })
}
