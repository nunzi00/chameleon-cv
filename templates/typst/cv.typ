// Plantilla base Typst de Chameleon CV (T-3.2, docs/typst-integration.md §4 y §6). Recibe la
// StructuredView (src/renderers/structured) ya decodificada: Markdown en línea como «runs», párrafos y
// listas como «blocks». No interpreta Markdown, no lee ficheros ni importa paquetes: solo maqueta datos.
// El documento principal que genera la CLI hace `#import "/cv.typ": cv` y `#cv(json(bytes("...")))`.

#let ink = rgb("#111111")
#let muted = rgb("#555555")
#let rule = rgb("#9a9a9a")

// Un run: texto con estilo. `link` es opcional (ausente en el JSON → none).
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  let url = r.at("link", default: none)
  if url != none { body = link(url, body) }
  body
}

#let runs(rs) = rs.map(run).join()

// Bloques: párrafos o ítems de lista (los `list.item` contiguos forman una sola lista).
#let blocks(bs) = {
  for b in bs {
    if b.runs.len() > 0 {
      if b.bullet { list.item(runs(b.runs)) } else { par(runs(b.runs)) }
    }
  }
}

#let achievement(a) = {
  let impact = a.at("impact", default: none)
  let tail = if impact != none { emph(" (" + impact + ")") } else { [] }
  list.item(runs(a.runs) + tail)
}

#let section(title) = {
  v(0.6em)
  block(
    width: 100%,
    below: 0.55em,
    inset: (bottom: 3pt),
    stroke: (bottom: 0.6pt + rule),
    text(size: 12.5pt, weight: "semibold")[#title],
  )
}

#let title(t) = block(above: 0.9em, below: 0.25em, text(size: 11.5pt, weight: "semibold")[#t])
#let meta(t) = block(below: 0.4em, text(size: 9.5pt, fill: muted, style: "italic")[#t])
#let technologies(label, names) = block(above: 0.3em, text(size: 9.5pt, fill: muted)[#emph(label + ":") #names])

// Contenedores (experiencias y proyectos) comparten maquetación.
#let container(d, heading, subtitle, item) = {
  title(heading)
  if subtitle != none and subtitle != "" { meta(subtitle) }
  blocks(item.summary)
  for a in item.achievements { achievement(a) }
  if item.technologies != "" { technologies(d.labels.technologies, item.technologies) }
}

#let cv(d) = {
  set document(title: "CV — " + d.fullName, author: d.fullName)
  set page(paper: "a4", margin: (x: 2cm, y: 1.8cm))
  set text(font: "Source Sans 3", size: 10.5pt, lang: d.lang, fill: ink)
  set strong(delta: 200) // Regular (400) → Semibold (600): las tres caras embebidas en templates/fonts
  set par(justify: false, leading: 0.5em)
  set list(marker: [•], indent: 0em, body-indent: 0.6em, spacing: 0.45em)
  show link: underline
  show raw.where(block: false): set text(size: 9.5pt)

  // Cabecera
  text(size: 22pt, weight: "semibold")[#d.fullName]
  let headline = d.at("headline", default: none)
  if headline != none { linebreak(); text(size: 12pt, weight: "semibold", fill: muted)[#headline] }
  if d.contact.len() > 0 { linebreak(); text(size: 9.5pt, fill: muted, runs(d.contact)) }
  if d.summary.len() > 0 { v(0.5em); blocks(d.summary) }

  if d.experience.len() > 0 {
    section(d.labels.experience)
    for item in d.experience {
      let location = item.at("location", default: none)
      let subtitle = if location != none { item.period + " · " + location } else { item.period }
      container(d, item.role + " · " + item.company, subtitle, item)
    }
  }

  if d.projects.len() > 0 {
    section(d.labels.projects)
    for item in d.projects {
      let role = item.at("role", default: none)
      let heading = if role != none { item.name + " · " + role } else { item.name }
      container(d, heading, item.meta, item)
    }
  }

  if d.skillGroups.len() > 0 {
    section(d.labels.skills)
    for g in d.skillGroups { list.item[#strong(g.label + ":") #g.names] }
  }

  if d.achievements.len() > 0 {
    section(d.labels.achievements)
    for a in d.achievements { achievement(a) }
  }

  if d.education.len() > 0 {
    section(d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let tail = (if field != none { " (" + field + ")" } else { "" }) + " · " + e.institution + (if e.period != "" { " · " + e.period } else { "" })
      list.item[#strong(e.degree)#tail]
    }
  }

  if d.certifications.len() > 0 {
    section(d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      let parts = ()
      if issuer != none { parts.push(issuer) }
      if c.date != "" { parts.push(c.date) }
      let tail = if parts.len() > 0 { " · " + parts.join(" · ") } else { "" }
      list.item[#strong(c.name)#tail#if url != none [ · #link(url)[#d.labels.link]]]
    }
  }

  if d.languages.len() > 0 {
    section(d.labels.languages)
    for l in d.languages { list.item[#l.name: #l.level] }
  }
}
