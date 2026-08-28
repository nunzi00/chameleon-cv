// Reproducción del PoC: en producción el JSON viaja por stdin como literal (docs/typst-integration.md §3.1);
// aquí se lee del fichero de ejemplo para que baste con un `typst compile`.
#import "/cv.typ": cv
#cv(json("/cv-backend.json"))
