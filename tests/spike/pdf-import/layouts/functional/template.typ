// Maquetación «ajena» del spike (T-8.4, corpus B): CV «funcional», por competencias. Primero las habilidades y los logros
// destacados; la trayectoria va al final como una lista compacta «periodo — puesto, empresa (lugar)» sin logros, y los logros
// de cada experiencia aparecen agrupados bajo «Logros profesionales» sin decir de qué empresa son. Mismo contrato cv(d, theme).
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  body
}
#let runs(rs) = rs.map(run).join()

#let cv(d, theme) = {
  set page(paper: "a4", margin: 16mm)
  set text(font: "Source Sans 3", size: 9.5pt, lang: d.lang)
  align(center)[#text(size: 20pt, weight: "bold")[#d.fullName]]
  let headline = d.at("headline", default: none)
  if headline != none { align(center)[#text(size: 10.5pt, fill: rgb("#444444"))[#headline]] }
  if d.contact.len() > 0 { align(center)[#text(size: 8.5pt)[#runs(d.contact)]] }
  v(6pt)
  if d.summary.len() > 0 {
    heading(level: 2)[Perfil profesional]
    for b in d.summary { if b.runs.len() > 0 { par(runs(b.runs)) } }
  }
  if d.skillGroups.len() > 0 {
    heading(level: 2)[Competencias]
    for g in d.skillGroups { [*#g.label*: #g.names \ ] }
  }
  if d.experience.len() > 0 {
    heading(level: 2)[Logros profesionales]
    for item in d.experience {
      for a in item.achievements { let impact = a.at("impact", default: none); list.item(runs(a.runs) + if impact != none [ (#impact)] else []) }
    }
    heading(level: 2)[Trayectoria]
    for item in d.experience {
      let location = item.at("location", default: none)
      [#item.period — *#item.role*, #item.company#if location != none [ (#location)] \ ]
    }
  }
  if d.projects.len() > 0 {
    heading(level: 2)[Proyectos]
    for item in d.projects { let role = item.at("role", default: none); [#item.meta — *#item.name*#if role != none [, #role] \ ] }
  }
  if d.education.len() > 0 {
    heading(level: 2)[Formación]
    for e in d.education { let field = e.at("field", default: none); [#e.period — *#e.degree*#if field != none [ (#field)], #e.institution \ ] }
  }
  if d.certifications.len() > 0 {
    heading(level: 2)[Certificaciones]
    for c in d.certifications { let issuer = c.at("issuer", default: none); [#c.date — #c.name#if issuer != none [, #issuer] \ ] }
  }
  if d.languages.len() > 0 {
    heading(level: 2)[Idiomas]
    [#d.languages.map(l => [#l.name (#l.level)]).join([, ])]
  }
}
