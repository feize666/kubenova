'use client';
import { ReloadOutlined } from '@ant-design/icons';
import { Alert, Button } from 'antd';
import { isResourceAccessDenied, visibleResourceQueryData } from '@/lib/query/visible-resource-data';

export interface ResourceQueryFeedbackProps {
  label:string;
  className?:string;
  query:{data?:unknown;error?:unknown;isError:boolean;isFetching:boolean;refetch:(options?:{cancelRefetch?:boolean})=>Promise<unknown>};
}
export function ResourceQueryFeedback({query,label,className}:ResourceQueryFeedbackProps) {
  if(!query.isError)return null;
  const denied=isResourceAccessDenied(query.error);
  const hasSnapshot=visibleResourceQueryData({data:query.data,error:query.error})!==undefined&&query.data!==null;
  const errorText=query.error instanceof Error?query.error.message:'请求失败';
  return <Alert className={className} showIcon type={hasSnapshot?'warning':'error'} title={denied?`${label}访问权限校验失败`:hasSnapshot?`${label}刷新失败，当前内容可能已过期`:`${label}加载失败`} description={denied?`${errorText}。当前资源内容已隐藏，请检查登录状态和访问授权。`:hasSnapshot?`${errorText}。已保留最近一次成功读取的数据。`:errorText} action={<Button icon={<ReloadOutlined/>} loading={query.isFetching} onClick={()=>void query.refetch({cancelRefetch:false}).catch(()=>{})}>重试</Button>}/>;
}
