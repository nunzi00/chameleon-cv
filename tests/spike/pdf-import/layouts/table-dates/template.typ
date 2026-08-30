// Maquetación «ajena» del spike (T-8.4, corpus B): la experiencia y la formación como TABLAS con las fechas en la primera
// columna («Periodo | Puesto | Empresa | Lugar»), los logros debajo de cada tabla como texto corrido con «—», y las
// habilidades como una tabla de dos columnas. Mismo contrato cv(d, theme).
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  body
}
#let runs(rs) = rs.map(run).join()

#let cv(d, theme) = {
  set page(paper: "a4", margin: 14mm)
  set text(font: "Source Sans 3", size: 9pt, lang: d.lang)
  set table(stroke: 0.4pt + rgb("#999999"), inset: 4pt)
  text(size: 18pt, weight: "bold")[#d.fullName]
  linebreak()
  let headline = d.at("headline", default: none)
  if headline != none { text(size: 10pt)[#headline]; linebreak() }
  if d.contact.len() > 0 { text(size: 8.5pt)[#runs(d.contact)]; linebreak() }
  v(4pt)
  if d.experience.len() > 0 {
    heading(level: 2, text(size: 11pt)[Experiencia laboral])
    table(
      columns: (auto, 1fr, 1fr, auto),
      [*Periodo*], [*Puesto*], [*Empresa*], [*Lugar*],
      ..d.experience.map(item => ([#item.period], [#item.role], [#item.company], [#item.at("location", default: "")])).flatten(),
    )
    for item in d.experience {
      text(weight: "bold")[#item.role — #item.company]
      linebreak()
      for a in item.achievements { let impact = a.at("impact", default: none); [— #runs(a.runs)#if impact != none [ (#impact)] \ ] }
      if item.technologies != "" { text(size: 8pt, fill: rgb("#555555"))[Tecnologías: #item.technologies]; linebreak() }
      v(3pt)
    }
  }
  if d.projects.len() > 0 {
    heading(level: 2, text(size: 11pt)[Proyectos])
    table(
      columns: (auto, 1fr, 1fr),
      [*Periodo*], [*Proyecto*], [*Rol*],
      ..d.projects.map(item => ([#item.meta], [#item.name], [#item.at("role", default: "")])).flatten(),
    )
    for item in d.projects {
      text(weight: "bold")[#item.name — #item.at("role", default: "")]
      linebreak()
      let url = item.at("url", default: none)
      if url != none { text(size: 8pt)[#url]; linebreak() }
      for a in item.achievements { let impact = a.at("impact", default: none); [— #runs(a.runs)#if impact != none [ (#impact)] \ ] }
      if item.technologies != "" { text(size: 8pt, fill: rgb("#555555"))[Tecnologías: #item.technologies]; linebreak() }
      v(3pt)
    }
  }
  if d.education.len() > 0 {
    heading(level: 2, text(size: 11pt)[Formación académica])
    table(
      columns: (auto, 1fr, 1fr),
      [*Periodo*], [*Título*], [*Centro*],
      ..d.education.map(e => { let field = e.at("field", default: none); ([#e.period], [#e.degree#if field != none [ (#field)]], [#e.institution]) }).flatten(),
    )
  }
  if d.skillGroups.len() > 0 {
    heading(level: 2, text(size: 11pt)[Competencias técnicas])
    table(columns: (auto, 1fr), ..d.skillGroups.map(g => ([*#g.label*], [#g.names])).flatten())
  }
  if d.certifications.len() > 0 {
    heading(level: 2, text(size: 11pt)[Certificados])
    table(columns: (auto, 1fr, auto), ..d.certifications.map(c => ([#c.date], [#c.name], [#c.at("issuer", default: "")])).flatten())
  }
  if d.languages.len() > 0 {
    heading(level: 2, text(size: 11pt)[Idiomas])
    table(columns: (auto, auto), ..d.languages.map(l => ([#l.name], [#l.level])).flatten())
  }
}
