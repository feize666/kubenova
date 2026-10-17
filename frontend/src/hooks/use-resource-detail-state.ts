'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import type { ResourceDetailRequest } from '@/lib/api/resources';
import { getDetailUrlController } from '@/components/resource-detail/detail-url';

/** The list owns the URL. Nested drawers must not independently claim it. */
export function useResourceDetailState() {
  const pathname=usePathname();
  const [owner]=useState(()=>({}));
  const [request,setRequest]=useState<ResourceDetailRequest|null>(null);
  const [session,setSession]=useState(0);
  useEffect(()=>getDetailUrlController(window).register(owner,(next,source)=>{
    setRequest(next);
    if(source==='restore')setSession(value=>value+1);
  }),[owner,pathname]);
  const navigate=useCallback((next:ResourceDetailRequest|null)=>{
    getDetailUrlController(window).navigate(owner,next);
  },[owner]);
  return [request,navigate,session] as const;
}
