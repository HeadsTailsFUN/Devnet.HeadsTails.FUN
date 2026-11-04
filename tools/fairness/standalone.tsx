import React from "react";
import {createRoot} from "react-dom/client";
import {FairnessPanel} from "../../apps/web/components/fairness/FairnessPanel";
createRoot(document.getElementById('verifier')!).render(<FairnessPanel standalone/>);
