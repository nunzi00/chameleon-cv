// Maquetación «ajena» del spike (T-8.4, corpus B): dos columnas con «iconos» de contacto, la empresa ANTES del rol,
// fechas en su propia línea, formación en tabla y habilidades como listas por categoría. Mismo contrato cv(d, theme).
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  let url = r.at("link", default: none)
  if url != none { body = link(url, body) }
  body
}
#let runs(rs) = rs.map(run).join()
#let blocks(bs) = { for b in bs { if b.runs.len() > 0 { if b.bullet { list.item(runs(b.runs)) } else { par(runs(b.runs)) } } } }

#let cv(d, theme) = {
  set page(paper: "a4", margin: 16mm)
  set text(font: "Source Sans 3", size: 9.5pt, lang: d.lang)
  set par(justify: false)
  // Cabecera: nombre grande y titular.
  text(size: 24pt, weight: "bold")[#d.fullName]
  linebreak()
  let headline = d.at("headline", default: none)
  if headline != none { text(size: 11pt, fill: rgb("#555555"))[#headline] }
  v(6pt)
  grid(
    columns: (1fr, 2.1fr),
    column-gutter: 14pt,
    {
      // Columna izquierda: contacto con glifos, habilidades, idiomas, certificaciones.
      if d.contact.len() > 0 {
        heading(level: 2, text(size: 10pt)[Contacto])
        for r in d.contact { if r.text != " · " and r.text != "" { [✉ #run(r) \ ] } }
      }
      if d.skillGroups.len() > 0 {
        heading(level: 2, text(size: 10pt)[Habilidades])
        for g in d.skillGroups { [*#g.label* \ ]; for n in g.names.split(", ") { list.item(n) } }
      }
      if d.languages.len() > 0 {
        heading(level: 2, text(size: 10pt)[Idiomas])
        for l in d.languages { [#l.name — #l.level \ ] }
      }
      if d.certifications.len() > 0 {
        heading(level: 2, text(size: 10pt)[Certificaciones])
        for c in d.certifications { let issuer = c.at("issuer", default: none); [☑ #c.name#if issuer != none [ (#issuer)], #c.date \ ] }
      }
    },
    {
      // Columna derecha: resumen, experiencia (empresa | rol), proyectos, formación en tabla.
      if d.summary.len() > 0 { heading(level: 2, text(size: 10pt)[Perfil]); blocks(d.summary) }
      if d.experience.len() > 0 {
        heading(level: 2, text(size: 10pt)[Experiencia profesional])
        for item in d.experience {
          let location = item.at("location", default: none)
          text(weight: "bold")[#item.company | #item.role]
          if location != none { text(fill: rgb("#555555"))[ (#location)] }
          linebreak()
          text(size: 8.5pt, fill: rgb("#555555"))[#item.period]
          blocks(item.summary)
          for a in item.achievements { let impact = a.at("impact", default: none); list.item(runs(a.runs) + if impact != none [ (#impact)] else []) }
          if item.technologies != "" { text(size: 8.5pt)[Stack: #item.technologies] }
          v(4pt)
        }
      }
      if d.projects.len() > 0 {
        heading(level: 2, text(size: 10pt)[Proyectos])
        for item in d.projects {
          let role = item.at("role", default: none)
          text(weight: "bold")[#item.name#if role != none [ | #role]]
          linebreak()
          text(size: 8.5pt, fill: rgb("#555555"))[#item.meta]
          blocks(item.summary)
          for a in item.achievements { list.item(runs(a.runs)) }
        }
      }
      if d.education.len() > 0 {
        heading(level: 2, text(size: 10pt)[Formación])
        table(
          columns: (auto, 1fr, auto),
          stroke: 0.5pt + rgb("#bbbbbb"),
          [*Título*], [*Centro*], [*Periodo*],
          ..d.education.map(e => { let field = e.at("field", default: none); ([#e.degree#if field != none [ (#field)]], [#e.institution], [#e.period]) }).flatten(),
        )
      }
      if d.achievements.len() > 0 {
        heading(level: 2, text(size: 10pt)[Logros destacados])
        for a in d.achievements { list.item(runs(a.runs)) }
      }
    },
  )
}
