"use client";

import { createContext, useContext } from "react";

export const EarnPointsContext = createContext<{ open: () => void } | null>(null);
export const useEarnPoints = () => useContext(EarnPointsContext);
