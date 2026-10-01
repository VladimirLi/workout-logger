## 1. Implementation

- [x] 1.1 `SetFocusLayout` takes a secondary action and lays it out before the primary on one
      row, wrapping the primary above it when the row is too narrow
- [x] 1.2 `EditSet` puts Cancel in the bar and Delete set on the "Editing set N" row
- [x] 1.3 The edit view scrolls to the top when it opens
- [x] 1.4 `scroll-padding-block-end` clears a two-row bar in portrait

## 2. Proof

- [x] 2.1 e2e: 375 x 667, one exercise, edit view at scroll 0: axe `target-size` passes, Cancel,
      Save changes and Delete set hit-test as themselves at centre and corners
- [x] 2.2 e2e: 320 px at 200% text: bar stacks, controls fully visible, tabbing never lands
      under the bar
- [x] 2.3 e2e: landscape 667 x 375: Cancel and Save share a row; opening Edit from the sets table
      with two and with five exercises lands at scroll 0
- [x] 2.4 e2e: two exercises in portrait still reachable
- [ ] 2.5 Independent review verdict and QA confirmation on the final SHA
