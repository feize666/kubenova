'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { message } from 'antd';
import { createActiveRefresh } from '@/lib/query/active-refresh';

export function usePageRefresh(){
  const client=useQueryClient();
  const [refreshing,setRefreshing]=useState(false);
  const refresh=useMemo(()=>createActiveRefresh(client,setRefreshing,()=>{
    void message.warning({content:'刷新失败，已保留当前页面内容，请检查各区域的错误提示后重试。',className:'ops-refresh-notice'});
  }),[client]);
  return {refreshing,refresh};
}
