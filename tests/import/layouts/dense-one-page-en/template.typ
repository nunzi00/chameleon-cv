// Maquetación «ajena» del spike (T-8.4, corpus B): una sola página muy densa, en inglés, sin viñetas: cada entrada en
// una línea «Role, Company (Location) — period» y los logros seguidos en un párrafo separados por «;». Mismo contrato.
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  let url = r.at("link", default: none)
  if url != none { body = link(url, body) }
  body
}
#let runs(rs) = rs.map(run).join()
#let inline(bs) = bs.filter(b => b.runs.len() > 0).map(b => runs(b.runs)).join([ ])

#let cv(d, theme) = {
  set page(paper: "a4", margin: 11mm)
  set text(font: "Source Sans 3", size: 8pt, lang: d.lang)
  set par(justify: true, leading: 0.5em)
  text(size: 15pt, weight: "bold")[#d.fullName]
  let headline = d.at("headline", default: none)
  if headline != none { text(size: 9pt)[ — #headline] }
  linebreak()
  if d.contact.len() > 0 { text(size: 7.5pt)[#runs(d.contact)]; linebreak() }
  if d.summary.len() > 0 { [*Summary.* #inline(d.summary)]; linebreak() }
  if d.experience.len() > 0 {
    text(weight: "bold", size: 9pt)[EXPERIENCE]
    linebreak()
    for item in d.experience {
      let location = item.at("location", default: none)
      [*#item.role*, #item.company#if location != none [ (#location)] — #item.period. ]
      [#inline(item.summary) ]
      [#item.achievements.map(a => { let impact = a.at("impact", default: none); runs(a.runs) + if impact != none [ (#impact)] else [] }).join([; ]).]
      if item.technologies != "" { [ _Technologies: #item.technologies._] }
      linebreak()
    }
  }
  if d.projects.len() > 0 {
    text(weight: "bold", size: 9pt)[PROJECTS]
    linebreak()
    for item in d.projects {
      let role = item.at("role", default: none)
      [*#item.name*#if role != none [, #role] — #item.meta. #inline(item.summary) #item.achievements.map(a => runs(a.runs)).join([; ]).]
      linebreak()
    }
  }
  if d.education.len() > 0 {
    text(weight: "bold", size: 9pt)[EDUCATION]
    linebreak()
    for e in d.education { let field = e.at("field", default: none); [*#e.degree*#if field != none [ (#field)], #e.institution — #e.period.]; linebreak() }
  }
  if d.skillGroups.len() > 0 {
    text(weight: "bold", size: 9pt)[SKILLS]
    linebreak()
    [#d.skillGroups.map(g => [*#g.label:* #g.names]).join([; ]).]
    linebreak()
  }
  if d.certifications.len() > 0 {
    text(weight: "bold", size: 9pt)[CERTIFICATIONS]
    linebreak()
    [#d.certifications.map(c => { let issuer = c.at("issuer", default: none); [#c.name#if issuer != none [ (#issuer)], #c.date] }).join([; ]).]
    linebreak()
  }
  if d.languages.len() > 0 {
    text(weight: "bold", size: 9pt)[LANGUAGES]
    linebreak()
    [#d.languages.map(l => [#l.name (#l.level)]).join([; ]).]
  }
}
