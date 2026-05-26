# Product Notes

Questo documento descrive le principali scelte progettuali correnti del sistema in forma statica, senza storico incrementale.

## Scelte tecniche correnti

- La modalità `foreign_only` usa una label di skip dedicata (`·`) per rendere espliciti i messaggi italiani esclusi intenzionalmente dal flusso automatico.
- I percorsi di discovery Gmail (`query` e `metadata`) applicano in modo coerente l'esclusione della label di skip.
- Quando un messaggio rientra nel flusso processabile e riceve `IA`, la label `·` viene rimossa automaticamente per mantenere la vista Gmail pulita e allineata allo stato operativo.
- In thread con più messaggi non letti, la marcatura di skip viene applicata in modo uniforme ai messaggi non ancora etichettati nei rami lingua sicuri, così da mantenere tracciabilità operativa.
