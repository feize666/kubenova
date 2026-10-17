# 资源编辑与访问方式实施计划

## 范围与约束
按已确认方案完善统一编辑器、企业风格表单及流程按钮、工作负载访问方式、IngressClass 和拓扑局部连线动效。沿用主题、权限、真实关系和共享 YAML 草稿；Ingress 拓扑位置/排序/关系不变。前端3000，本地受控验证；不提交、推送或向业务集群创建资源。保留既有未提交更新/部署改动。

## 阶段与门禁
1. 基线：记录 dirty 文件与独立 worktree 基线，核对已有编辑/dry-run/抽屉接口。
2. 编辑器 UI：三步创建、单页分区编辑、限宽布局、无箭头流程按钮、错误定位和内存草稿；字段外数据无损，响应式与主题通过。
3. 原生表单：Secret 三类型上传/匹配校验、IngressClass 参数/作用域表单；限制字节和文件数，敏感数据不持久化，行为测试通过。
4. 访问方式：真实 selector/后端关联、Service/Ingress 草稿和影响预览；保持详情上下文，安全权限与失败回退通过。
5. 网络入口与拓扑：IngressClass 列表及默认类/引用检查；直接入出边流动覆盖层、减少动画、空白重置；布局与原边不变。
6. 集成：逐切片检查补丁并验证，tsc/针对性 tests/build；浏览器明暗/窄屏/错误/返回/详情/动效验证；验收后回收本轮 worktree、agent 和临时产物。

## 并行边界
- editor-ui：resource-editor-page、workload-resource-form/workload-fields、其 CSS 与测试、editor navigation。输入已有编辑器，输出可用创建/编辑交互。
- native-ui：native/schema 表单及辅助、Secret 专用组件/测试、IngressClass 原生表单。不得修改 editor page/detail 或后端。
- access：资源详情访问页、真实关系辅助/测试、资源编辑侧面板；必要后端 resources 专用接口。不得修改 editor page/native form/菜单/拓扑。
- root：公共路由/网络菜单/IngressClass 页面、全站流程按钮、拓扑边、共享类型、审查集成和浏览器验收。

## 风险与恢复
Worktree 使用工作区当前内容为基线，集成仅应用本轮增量，绝不回退旧 dirty 文件。多对象变更展示部分成功，不宣称事务；失败保留输入。默认类及删除权限服务端复核，selector 匹配不借 metadata 标签虚构关系。无真实测试集群时仅用明确的受控 API 测试写路径并区分真实只读验收。

## 验证记录
待实施；每阶段记录实际命令和结果，不以 HTTP200 或编译通过代替浏览器验收。
