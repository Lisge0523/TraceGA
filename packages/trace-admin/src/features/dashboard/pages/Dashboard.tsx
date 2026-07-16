import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { Spin, Card, Button, Row, Col } from 'antd'
import { EditOutlined, CheckOutlined } from '@ant-design/icons'
import ReactECharts from 'echarts-for-react'
import { Responsive, WidthProvider } from 'react-grid-layout/legacy'
import type { Layout, ResponsiveLayouts } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { getOverview, getEventTrend, getTopEvents } from '@/api'
import type { AnalyticsOverview, EventTrend, TopEvent } from '@/types'
import { StatCard } from '@/components'
import './Dashboard.css'

const ResponsiveGridLayout = WidthProvider(Responsive)

const STORAGE_KEY = 'tracega-dashboard-layout'

// 默认布局配置
const DEFAULT_LAYOUTS: ResponsiveLayouts = {
  lg: [
    { i: 'stats', x: 0, y: 0, w: 12, h: 3, static: true },
    { i: 'trend', x: 0, y: 3, w: 8, h: 8, minW: 4, minH: 4 },
    { i: 'pie', x: 8, y: 3, w: 4, h: 8, minW: 3, minH: 4 },
  ],
}

// 从 localStorage 恢复布局（仅在组件外部使用）
const loadLayoutFromStorage = (): ResponsiveLayouts => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      return JSON.parse(saved) as ResponsiveLayouts
    }
  } catch {
    // ignore
  }
  return DEFAULT_LAYOUTS
}

// 持久化布局到 localStorage
const persistLayout = (layouts: ResponsiveLayouts): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts))
  } catch {
    // ignore
  }
}

export const Dashboard: React.FC = () => {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null)
  const [eventTrend, setEventTrend] = useState<EventTrend[]>([])
  const [topEvents, setTopEvents] = useState<TopEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [isEditMode, setIsEditMode] = useState(false)

  // 初始化时从 localStorage 恢复布局（仅执行一次）
  const initialLayout = useMemo(() => loadLayoutFromStorage(), [])

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [overviewRes, trendRes, topRes] = await Promise.all([
          getOverview({}),
          getEventTrend({ interval: 'day' }),
          getTopEvents({ limit: 5 }),
        ])
        setOverview(overviewRes)
        setEventTrend(trendRes)
        setTopEvents(topRes)
      } catch (error) {
        console.error('Failed to fetch dashboard data:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  // 布局变更时保存
  const handleLayoutChange = useCallback((_layout: Layout, layouts: ResponsiveLayouts) => {
    persistLayout(layouts)
  }, [])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
        <Spin size="large" />
      </div>
    )
  }

  const trendOption = {
    tooltip: {
      trigger: 'axis' as const,
    },
    xAxis: {
      type: 'category' as const,
      data: eventTrend.map((item) => item.time),
    },
    yAxis: {
      type: 'value' as const,
    },
    series: [
      {
        name: '事件数',
        type: 'bar' as const,
        data: eventTrend.map((item) => item.count),
        itemStyle: {
          color: '#3b82f6',
        },
      },
    ],
  }

  const topEventsOption = {
    tooltip: {
      trigger: 'item' as const,
    },
    series: [
      {
        name: '热门事件',
        type: 'pie' as const,
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 4,
          borderColor: '#fff',
          borderWidth: 2,
        },
        label: {
          show: true,
          formatter: '{b}: {c}',
        },
        data: topEvents.map((item, index) => ({
          value: item.count,
          name: item.name,
          itemStyle: {
            color: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'][index],
          },
        })),
      },
    ],
  }

  // 拖拽手柄组件（仅在编辑模式下显示）
  const dragHandle = isEditMode ? (
    <span className="drag-handle">⋮⋮</span>
  ) : null

  return (
    <div className={isEditMode ? 'dashboard-edit-mode' : undefined}>
      {/* 标题栏与编辑模式切换 */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 600, color: '#1e293b', margin: 0 }}>
          数据看板
        </h1>
        <Button
          type={isEditMode ? 'primary' : 'default'}
          icon={isEditMode ? <CheckOutlined /> : <EditOutlined />}
          onClick={() => setIsEditMode(!isEditMode)}
        >
          {isEditMode ? '完成编辑' : '编辑布局'}
        </Button>
      </div>

      {/* 可拖拽缩放网格 */}
      <ResponsiveGridLayout
        className="layout"
        layouts={initialLayout}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={50}
        margin={[16, 16]}
        isDraggable={isEditMode}
        isResizable={isEditMode}
        draggableHandle=".drag-handle"
        draggableCancel="button,input,select,.ant-btn,.ant-select,.ant-picker,canvas"
        onLayoutChange={handleLayoutChange}
      >
        {/* 统计卡片区域 - static: 不可拖拽缩放的固定区域 */}
        <div key="stats" style={{ background: 'transparent' }}>
          <Row gutter={16}>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="总事件数" value={overview?.totalEvents || 0} change="+12.5%" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="总用户数" value={overview?.totalUsers || 0} change="+8.3%" />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard
                title="平均会话时长"
                value={`${overview?.avgSessionDuration || 0}s`}
                change="-2.1%"
                changeType="negative"
              />
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <StatCard title="转化率" value={`${overview?.conversionRate || 0}%`} change="+3.7%" />
            </Col>
          </Row>
        </div>

        {/* 事件趋势图 */}
        <div key="trend" style={{ height: '100%' }}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>事件趋势</span>
                {dragHandle}
              </div>
            }
            styles={{ body: { height: 'calc(100% - 57px)', padding: 16 } }}
            style={{ height: '100%', overflow: 'hidden' }}
          >
            <ReactECharts option={trendOption} style={{ height: '100%', width: '100%' }} />
          </Card>
        </div>

        {/* 热门事件饼图 */}
        <div key="pie" style={{ height: '100%' }}>
          <Card
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>热门事件</span>
                {dragHandle}
              </div>
            }
            styles={{ body: { height: 'calc(100% - 57px)', padding: 16 } }}
            style={{ height: '100%', overflow: 'hidden' }}
          >
            <ReactECharts option={topEventsOption} style={{ height: '100%', width: '100%' }} />
          </Card>
        </div>
      </ResponsiveGridLayout>
    </div>
  )
}
