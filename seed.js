/* Copia de rutina.json para poder abrir index.html con doble clic (file://),
   donde el navegador bloquea fetch(). Se usa solo si fetch('rutina.json') falla. */
window.SEED_DATA = {
  "version": 1,
  "routine": {
    "days": [
      {
        "id": "d1",
        "name": "Día 1",
        "exercises": [
          {
            "name": "Banco plano",
            "sets": 3,
            "reps": "4",
            "targetWeight": 60,
            "notes": "Serie previa: 70 kg x1 con 1 seg de pausa (grabar video). REVISAR interpretación.",
            "original": "Banco plano 70x1 1seg pausa vidéo 60 3x4"
          },
          {
            "name": "Press inclinado con barra",
            "sets": 3,
            "reps": "6",
            "targetWeight": null,
            "notes": "",
            "original": "Press inclinado barra 3x6"
          },
          {
            "name": "Aperturas en máquina",
            "sets": 4,
            "reps": "10",
            "targetWeight": null,
            "notes": "2 seg de pausa",
            "original": "aperturas en máquina 4x 10 2 s pausa"
          },
          {
            "name": "Vuelos laterales",
            "sets": 4,
            "reps": "15",
            "targetWeight": null,
            "notes": "",
            "original": "vuelos laterales 4x15"
          },
          {
            "name": "Curl francés con barra W",
            "sets": 3,
            "reps": "10",
            "targetWeight": null,
            "notes": "",
            "original": "curl francés barra w 3x10"
          },
          {
            "name": "Extensión de tríceps en polea",
            "sets": 4,
            "reps": "10-10",
            "targetWeight": null,
            "notes": "Drop set: 10 reps y otras 10 con menos peso",
            "original": "ext tríceps polea 4x10-10 menos peso"
          }
        ]
      },
      {
        "id": "d2",
        "name": "Día 2",
        "exercises": [
          {
            "name": "Sentadilla con barra",
            "sets": 4,
            "reps": "4",
            "targetWeight": 50,
            "notes": "",
            "original": "Sentadilla barra 4x4 50"
          },
          {
            "name": "Peso muerto",
            "sets": 4,
            "reps": "5",
            "targetWeight": 65,
            "notes": "",
            "original": "peso muerto 4x5 65"
          },
          {
            "name": "Sentadilla en V (Vsq)",
            "sets": 4,
            "reps": "10",
            "targetWeight": null,
            "notes": "Bajando lento",
            "original": "Vsq 4x10 bajando lento"
          },
          {
            "name": "Sillón de cuádriceps",
            "sets": 3,
            "reps": "10-10",
            "targetWeight": null,
            "notes": "Drop set: 10 reps y otras 10 con menos peso",
            "original": "sillón cuádriceps 3x10-10 menos peso"
          },
          {
            "name": "Camilla de isquiotibiales",
            "sets": 4,
            "reps": "10",
            "targetWeight": null,
            "notes": "",
            "original": "camilla izq 4x10 (typo del PDF: es camilla de isquio)"
          },
          {
            "name": "Aductores + abductores",
            "sets": 3,
            "reps": "12-15",
            "targetWeight": null,
            "notes": "",
            "original": "aductores+abductores 3x12-15"
          }
        ]
      },
      {
        "id": "d3",
        "name": "Día 3",
        "exercises": [
          {
            "name": "Banco plano",
            "sets": 4,
            "reps": "5",
            "targetWeight": 55,
            "notes": "3 seg de pausa",
            "original": "Banco plano 3s pausa 4x5 55"
          },
          {
            "name": "Remo con barra",
            "sets": 4,
            "reps": "8",
            "targetWeight": null,
            "notes": "",
            "original": "remo barra 4x8"
          },
          {
            "name": "Remo a 1 brazo con mancuernas",
            "sets": 4,
            "reps": "8",
            "targetWeight": null,
            "notes": "",
            "original": "Remo 1 brazo mancuernas 4x8"
          },
          {
            "name": "Remo alto cerrado",
            "sets": 4,
            "reps": "10",
            "targetWeight": null,
            "notes": "",
            "original": "remo alto cerrado 4x10"
          },
          {
            "name": "Jalón dorsal",
            "sets": 4,
            "reps": "15",
            "targetWeight": null,
            "notes": "",
            "original": "Jalón dorsal 4x15"
          },
          {
            "name": "Curl de bíceps con barra W",
            "sets": 4,
            "reps": "10",
            "targetWeight": null,
            "notes": "",
            "original": "Curl bíceps barra w 4x10"
          },
          {
            "name": "Bíceps en máquina",
            "sets": 3,
            "reps": "15",
            "targetWeight": null,
            "notes": "",
            "original": "bíceps máquina 3x15"
          }
        ]
      }
    ]
  },
  "weightUnit": "kg",
  "sessions": []
};

/* Copia de ejemplo.json (rutina de ejemplo para quien instala la app por primera vez),
   para file:// o si fetch('ejemplo.json') falla. */
window.EXAMPLE_DATA = {
  "version": 1,
  "routine": {
    "days": [
      {
        "id": "e1",
        "name": "Día 1 · Pecho, hombros y tríceps",
        "exercises": [
          {
            "name": "Press de banca",
            "sets": 3,
            "reps": "8-12",
            "targetWeight": null,
            "notes": "Bajá controlado hasta rozar el pecho.",
            "muscles": {
              "primary": [
                "Pecho"
              ],
              "secondary": [
                "Tríceps",
                "Hombros"
              ]
            }
          },
          {
            "name": "Press de hombros con mancuernas",
            "sets": 3,
            "reps": "8-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Hombros"
              ],
              "secondary": [
                "Tríceps"
              ]
            }
          },
          {
            "name": "Aperturas en máquina",
            "sets": 3,
            "reps": "10-15",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Pecho"
              ],
              "secondary": []
            }
          },
          {
            "name": "Elevaciones laterales",
            "sets": 3,
            "reps": "12-15",
            "targetWeight": null,
            "notes": "Peso liviano, sin balancear el cuerpo.",
            "muscles": {
              "primary": [
                "Hombros"
              ],
              "secondary": []
            }
          },
          {
            "name": "Extensión de tríceps en polea",
            "sets": 3,
            "reps": "10-10",
            "targetWeight": null,
            "notes": "Drop set: 10 repeticiones y, sin descansar, otras 10 con menos peso.",
            "muscles": {
              "primary": [
                "Tríceps"
              ],
              "secondary": []
            }
          }
        ]
      },
      {
        "id": "e2",
        "name": "Día 2 · Piernas",
        "exercises": [
          {
            "name": "Sentadilla",
            "sets": 3,
            "reps": "8-12",
            "targetWeight": null,
            "notes": "Rodillas en la línea de los pies.",
            "muscles": {
              "primary": [
                "Cuádriceps",
                "Glúteos"
              ],
              "secondary": [
                "Isquiotibiales"
              ]
            }
          },
          {
            "name": "Prensa de piernas",
            "sets": 3,
            "reps": "10-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Cuádriceps"
              ],
              "secondary": [
                "Glúteos"
              ]
            }
          },
          {
            "name": "Curl femoral en máquina",
            "sets": 3,
            "reps": "10-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Isquiotibiales"
              ],
              "secondary": []
            }
          },
          {
            "name": "Elevación de talones",
            "sets": 3,
            "reps": "12-15",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Pantorrillas"
              ],
              "secondary": []
            }
          },
          {
            "name": "Plancha",
            "sets": 3,
            "reps": "30 s",
            "targetWeight": null,
            "notes": "Superserie con el siguiente: hacé uno y enseguida el otro, después descansá.",
            "group": "ss1",
            "muscles": {
              "primary": [
                "Core"
              ],
              "secondary": []
            }
          },
          {
            "name": "Elevación de piernas acostado",
            "sets": 3,
            "reps": "12",
            "targetWeight": null,
            "notes": "",
            "group": "ss1",
            "muscles": {
              "primary": [
                "Core"
              ],
              "secondary": []
            }
          }
        ]
      },
      {
        "id": "e3",
        "name": "Día 3 · Espalda y bíceps",
        "exercises": [
          {
            "name": "Jalón al pecho",
            "sets": 3,
            "reps": "8-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Espalda"
              ],
              "secondary": [
                "Bíceps"
              ]
            }
          },
          {
            "name": "Remo con mancuerna",
            "sets": 3,
            "reps": "8-12",
            "targetWeight": null,
            "notes": "Una mano apoyada en el banco, espalda recta.",
            "muscles": {
              "primary": [
                "Espalda"
              ],
              "secondary": [
                "Bíceps"
              ]
            }
          },
          {
            "name": "Remo sentado en polea",
            "sets": 3,
            "reps": "10-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Espalda"
              ],
              "secondary": []
            }
          },
          {
            "name": "Curl de bíceps con mancuernas",
            "sets": 3,
            "reps": "10-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Bíceps"
              ],
              "secondary": [
                "Antebrazos"
              ]
            }
          },
          {
            "name": "Curl martillo",
            "sets": 3,
            "reps": "10-12",
            "targetWeight": null,
            "notes": "",
            "muscles": {
              "primary": [
                "Bíceps",
                "Antebrazos"
              ],
              "secondary": []
            }
          }
        ]
      }
    ]
  },
  "weightUnit": "kg",
  "sessions": []
};
