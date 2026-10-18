import { createContext, useContext } from 'react';

export interface ToastLink {
  to: string;
  label: string;
}

export type ShowToast = (text: string, link?: ToastLink) => void;

export const ToastContext = createContext<ShowToast>(() => {});

/** Show a short past-tense confirmation, optionally linking to the result. */
export function useToast(): ShowToast {
  return useContext(ToastContext);
}
