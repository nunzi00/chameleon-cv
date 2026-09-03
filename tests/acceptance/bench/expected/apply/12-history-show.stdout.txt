---
company: Nexo Pagos
role: Staff Backend Engineer
location: Valencia (remoto)
start: 2022-03
end:
tags: [php, symfony, kubernetes, kafka, postgresql, api]
technologies: [PHP 8.3, Symfony 7, Kafka, PostgreSQL 16, Kubernetes, Terraform]
---

Pasarela de pagos B2B con **9 M de transacciones al mes** y disponibilidad comprometida del 99,95 %. Equipo de plataforma de pagos de 8 personas.

## Logros

- Diseñé la arquitectura de la nueva pasarela de pagos sobre Kafka y PostgreSQL, procesando **9 M de transacciones al mes** sin pérdida de eventos. #kafka #postgresql #arquitectura #pin
  - impact: 0 incidentes de pérdida de datos en 18 meses
  - date: 2023-02
  - id: exp-nexo-pasarela
- Reduje la latencia `p99` de la API de autorización de 480 ms a 210 ms rediseñando la capa de caché y los índices. #performance #api #postgresql
  - impact: -56 % p99
  - date: 2023-09
- Lideré la migración de 14 servicios PHP a Kubernetes con despliegues canary y sin ventana de parada. #kubernetes #ci-cd #liderazgo
  - impact: despliegues diarios frente a quincenales
  - date: 2024-04
- Implanté *contract testing* entre el monolito Symfony y los microservicios de liquidación. #testing #symfony #api
  - date: 2024-10
- Mentoricé a 4 ingenieros de nivel medio; dos fueron promocionados a senior en un año. #mentoria #liderazgo #gestion
  - impact: 2 promociones
  - date: 2025-06
- Definí los SLO de la pasarela y el proceso de guardia, reduciendo las alertas nocturnas en un **70 %**. #sre #observability #gestion
  - impact: -70 % alertas nocturnas
  - date: 2025-11
