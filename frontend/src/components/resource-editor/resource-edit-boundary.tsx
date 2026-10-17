'use client';
import { createContext, useContext, useMemo, useRef, type RefObject } from 'react';

type LeaveRequest=(action:()=>void)=>void;
interface EditBoundary {request:LeaveRequest;ref:RefObject<LeaveRequest|null>}
export const ResourceEditBoundaryContext=createContext<EditBoundary|null>(null);
export function useResourceEditBoundary() {
  const ref=useRef<LeaveRequest|null>(null);
  return useMemo<EditBoundary>(()=>({ref,request:action=>{if(ref.current)ref.current(action);else action();}}),[]);
}
export function useOptionalResourceEditBoundary(){return useContext(ResourceEditBoundaryContext);}
