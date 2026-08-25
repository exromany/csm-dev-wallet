import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OperatorList } from '../../entrypoints/popup/OperatorList.js';
import { makeOperator, ADDR_A, ADDR_B } from '../fixtures.js';

const noopFavorites = { toggle: vi.fn(), isFavorite: () => false };
const noopSelect = vi.fn();
const noopLabels = { get: () => '', set: vi.fn() };

const baseProps = {
  loading: false,
  favorites: noopFavorites,
  operatorLabels: noopLabels,
  onSelect: noopSelect,
  allOperatorsCount: 0,
};

describe('OperatorList', () => {
  it('shows spinner when loading with no operators', () => {
    render(<OperatorList {...baseProps} operators={[]} loading={true} />);
    expect(screen.getByText('Loading operators...')).toBeInTheDocument();
  });

  it('does NOT show spinner when loading but operators already present', () => {
    const ops = [makeOperator({ id: '1' })];
    render(<OperatorList {...baseProps} operators={ops} loading={true} />);
    expect(screen.queryByText('Loading operators...')).not.toBeInTheDocument();
    expect(screen.getByText('#1')).toBeInTheDocument();
  });

  it('shows "No operators found" when empty and not loading', () => {
    render(<OperatorList {...baseProps} operators={[]} />);
    expect(screen.getByText('No operators found')).toBeInTheDocument();
  });

  it('renders operator with #id header', () => {
    const ops = [makeOperator({ id: '42' })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('#42')).toBeInTheDocument();
  });

  it('groups same address into single row with both MGR and RWD badges', () => {
    const ops = [makeOperator({ id: '1', managerAddress: ADDR_A, rewardsAddress: ADDR_A })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('MGR')).toBeInTheDocument();
    expect(screen.getByText('RWD')).toBeInTheDocument();
    const addressRows = screen.getAllByText(/0xaAaA…aaAa/);
    expect(addressRows).toHaveLength(1);
  });

  it('marks MGR pill as owner when the manager holds extended permissions', () => {
    const ops = [makeOperator({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_B,
      extendedManagerPermissions: true,
    })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('MGR').className).toContain('owner');
    expect(screen.getByText('RWD').className).not.toContain('owner');
  });

  it('carries owner wording as data-hint on an owner role pill', () => {
    const ops = [makeOperator({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_B,
      extendedManagerPermissions: true,
    })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('MGR')).toHaveAttribute('data-hint', 'Manager address · owner');
  });

  it('marks RWD pill as owner when the manager lacks extended permissions', () => {
    const ops = [makeOperator({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_B,
      extendedManagerPermissions: false,
    })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('MGR').className).not.toContain('owner');
    expect(screen.getByText('RWD').className).toContain('owner');
  });

  it('marks a single owner pill when one address holds both roles', () => {
    const ops = [makeOperator({
      id: '1',
      managerAddress: ADDR_A,
      rewardsAddress: ADDR_A,
      extendedManagerPermissions: true,
    })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('MGR').className).toContain('owner');
    expect(screen.getByText('RWD').className).not.toContain('owner');
    expect(screen.getByText('RWD')).toHaveAttribute('data-hint', 'Rewards address');
  });

  it('shows filled star when favorite', () => {
    const ops = [makeOperator({ id: '1' })];
    const favorites = { toggle: vi.fn(), isFavorite: () => true };
    render(<OperatorList {...baseProps} operators={ops} favorites={favorites} />);
    expect(screen.getByText('★')).toBeInTheDocument();
  });

  it('shows empty star when not favorite', () => {
    const ops = [makeOperator({ id: '1' })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('☆')).toBeInTheDocument();
  });

  it('renders operator label when set', () => {
    const ops = [makeOperator({ id: '1' })];
    const labels = { get: () => 'Kiln', set: vi.fn() };
    render(<OperatorList {...baseProps} operators={ops} operatorLabels={labels} />);
    expect(screen.getByText('Kiln')).toBeInTheDocument();
  });

  it('renders "+ label" placeholder when no label set', () => {
    const ops = [makeOperator({ id: '1' })];
    render(<OperatorList {...baseProps} operators={ops} />);
    expect(screen.getByText('+ label')).toBeInTheDocument();
  });
});
