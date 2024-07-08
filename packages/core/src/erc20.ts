import { Contract, ContractBuilder } from './contract';
import { Access, setAccessControl, requireAccessControl } from './set-access-control';
import { addPauseFunctions } from './add-pausable';
import { defineFunctions } from './utils/define-functions';
import { CommonOptions, withCommonDefaults, defaults as commonDefaults } from './common-options';
import { setUpgradeable } from './set-upgradeable';
import { setInfo } from './set-info';
import { printContract } from './print';
import { ClockMode, clockModeDefault, setClockMode } from './set-clock-mode';

export const restrictionOptions = ['blocklist', 'allowlist'] as const;
export const restrictionDefault = 'blocklist' as const;
export type Restriction = typeof restrictionOptions[number];

export interface ERC20Options extends CommonOptions {
  name: string;
  symbol: string;
  burnable?: boolean;
  pausable?: boolean;
  premint?: string;
  mintable?: boolean;
  permit?: boolean;
  restriction?: boolean | Restriction;
  custodian?: boolean;
  limit?: string;
  /**
   * Whether to keep track of historical balances for voting in on-chain governance, and optionally specify the clock mode.
   * Setting `true` is equivalent to 'blocknumber'. Setting a clock mode implies voting is enabled.
   */
  votes?: boolean | ClockMode;
  flashmint?: boolean;
}

export const defaults: Required<ERC20Options> = {
  name: 'MyToken',
  symbol: 'MTK',
  burnable: false,
  pausable: false,
  premint: '0',
  mintable: false,
  permit: true,
  restriction: false,
  custodian: false,
  limit: '0',
  votes: false,
  flashmint: false,
  access: commonDefaults.access,
  upgradeable: commonDefaults.upgradeable,
  info: commonDefaults.info,
} as const;

function withDefaults(opts: ERC20Options): Required<ERC20Options> {
  return {
    ...opts,
    ...withCommonDefaults(opts),
    burnable: opts.burnable ?? defaults.burnable,
    pausable: opts.pausable ?? defaults.pausable,
    premint: opts.premint || defaults.premint,
    mintable: opts.mintable ?? defaults.mintable,
    permit: opts.permit ?? defaults.permit,
    restriction: opts.restriction ?? defaults.restriction,
    custodian: opts.custodian ?? defaults.custodian,
    limit: opts.limit || defaults.limit,
    votes: opts.votes ?? defaults.votes,
    flashmint: opts.flashmint ?? defaults.flashmint,
  };
}

export function printERC20(opts: ERC20Options = defaults): string {
  return printContract(buildERC20(opts));
}

export function isAccessControlRequired(opts: Partial<ERC20Options>): boolean {
  return opts.mintable || opts.custodian || opts.pausable || opts.upgradeable === 'uups';
}

export function buildERC20(opts: ERC20Options): Contract {
  const allOpts = withDefaults(opts);

  const c = new ContractBuilder(allOpts.name);

  const { access, upgradeable, info } = allOpts;

  addBase(c, allOpts.name, allOpts.symbol);

  if (allOpts.burnable) {
    addBurnable(c);
  }

  if (allOpts.pausable) {
    addPausableExtension(c, access);
  }

  if (allOpts.premint) {
    addPremint(c, allOpts.premint);
  }

  if (allOpts.mintable) {
    addMintable(c, access);
  }

  if (allOpts.restriction) {
    const restriction = allOpts.restriction === true ? restrictionDefault : allOpts.restriction;
    addRestriction(c, access, restriction);
  }

  if (allOpts.custodian) {
    addCustodian(c, access);
  }

  if (allOpts.limit) {
    addLimit(c, allOpts.limit);
  }

  // Note: Votes requires Permit
  if (allOpts.permit || allOpts.votes) {
    addPermit(c, allOpts.name);
  }

  if (allOpts.votes) {
    const clockMode = allOpts.votes === true ? clockModeDefault : allOpts.votes;
    addVotes(c, clockMode);
  }

  if (allOpts.flashmint) {
    addFlashMint(c);
  }

  setAccessControl(c, access);
  setUpgradeable(c, upgradeable, access);
  setInfo(c, info);

  return c;
}

function addBase(c: ContractBuilder, name: string, symbol: string) {
  const ERC20 = {
    name: 'ERC20',
    path: '@openzeppelin/contracts/token/ERC20/ERC20.sol',
  };
  c.addParent(
    ERC20,
    [name, symbol],
  );

  c.addOverride(ERC20, functions._update);
}

function addRestriction(c: ContractBuilder, access: Access, restriction: Restriction) {
  if (restriction === 'blocklist') {
    addBlocklist(c, access);
  } else {
    addAllowlist(c, access);
  }
}

function addBlocklist(c: ContractBuilder, access: Access) {
  
  c.addVariable('mapping(address => bool) public blocked;');

  requireAccessControl(c, functions.blockUser, access, 'BLOCKER', 'blocker');
  c.addFunctionCode('blocked[user] = true;', functions.blockUser);

  requireAccessControl(c, functions.unblockUser, access, 'BLOCKER', 'blocker');
  c.addFunctionCode('blocked[user] = false;', functions.unblockUser);

  c.addFunctionCode('if (from != address(0)) require(!blocked[from], "ERC20Blacklist: Blocked");', functions._update);
}

function addAllowlist(c: ContractBuilder, access: Access) {
  c.addVariable('mapping(address => bool) public allowed;');

  requireAccessControl(c, functions.allow, access, 'ALLOWER', 'allower');
  c.addFunctionCode('allowed[user] = true;', functions.allow);

  requireAccessControl(c, functions.unallow, access, 'ALLOWER', 'allower');
  c.addFunctionCode('allowed[user] = false;', functions.unallow);

  c.addFunctionCode('if (from != address(0) && to != address(0)) require(allowed[from] && allowed[to], "ERC20Allowlist: Unallowed");', functions._update);
}

function addCustodian(c: ContractBuilder, access: Access) {
  requireAccessControl(c, functions.update, access, 'CUSTODIAN', 'custodian');
  c.addFunctionCode('_update(from, to, value);', functions.update);
}

function addPausableExtension(c: ContractBuilder, access: Access) {
  const ERC20Pausable = {
    name: 'ERC20Pausable',
    path: '@openzeppelin/contracts/token/ERC20/extensions/ERC20Pausable.sol',
  };
  c.addParent(ERC20Pausable);
  c.addOverride(ERC20Pausable, functions._update);

  addPauseFunctions(c, access);
}

function addBurnable(c: ContractBuilder) {
  c.addParent({
    name: 'ERC20Burnable',
    path: '@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol',
  });
}

export const premintPattern = /^(\d*)(?:\.(\d+))?(?:e(\d+))?$/;

function addPremint(c: ContractBuilder, amount: string) {
  const m = amount.match(premintPattern);
  if (m) {
    const integer = m[1]?.replace(/^0+/, '') ?? '';
    const decimals = m[2]?.replace(/0+$/, '') ?? '';
    const exponent = Number(m[3] ?? 0);

    if (Number(integer + decimals) > 0) {
      const decimalPlace = decimals.length - exponent;
      const zeroes = new Array(Math.max(0, -decimalPlace)).fill('0').join('');
      const units = integer + decimals + zeroes;
      const exp = decimalPlace <= 0 ? 'decimals()' : `(decimals() - ${decimalPlace})`;
      c.addConstructorCode(`_mint(msg.sender, ${units} * 10 ** ${exp});`);
    }
  }
}

function addLimit(c: ContractBuilder, amount: string) {
  const m = amount.match(premintPattern);
  if (m) {
    const integer = m[1]?.replace(/^0+/, '') ?? '';
    const decimals = m[2]?.replace(/0+$/, '') ?? '';
    const exponent = Number(m[3] ?? 0);

    if (Number(integer + decimals) > 0) {
      const decimalPlace = decimals.length - exponent;
      const zeroes = new Array(Math.max(0, -decimalPlace)).fill('0').join('');
      const units = integer + decimals + zeroes;
      const exp = decimalPlace <= 0 ? 'decimals()' : `(decimals() - ${decimalPlace})`;

      c.addVariable('uint256 public immutable TOKEN_LIMIT;');
      c.addVariable('mapping(address => TransferRecord) private records;');
      c.addVariable('struct TransferRecord { uint256 amount; uint256 timestamp; }');

      c.addConstructorCode(`TOKEN_LIMIT = ${units} * 10 ** ${exp};`);
      c.addFunctionCode('if (from != address(0)) _limit(from, value);', functions._update);

      c.setFunctionBody(['TransferRecord storage record = records[account];', 'if (block.timestamp - record.timestamp >= 1 days) {','    record.amount = value;', '    record.timestamp = block.timestamp;', '} else {', '    uint256 newTotal = record.amount + value;', '    require(newTotal <= TOKEN_LIMIT, "ERC20Limit: Limited");', '    record.amount = newTotal;', '}'], functions._limit);
    }
  }
}

function addMintable(c: ContractBuilder, access: Access) {
  requireAccessControl(c, functions.mint, access, 'MINTER', 'minter');
  c.addFunctionCode('_mint(to, amount);', functions.mint);
}

function addPermit(c: ContractBuilder, name: string) {
  const ERC20Permit = {
    name: 'ERC20Permit',
    path: '@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol',
  };
  c.addParent(ERC20Permit, [name]);
  c.addOverride(ERC20Permit, functions.nonces);

}

function addVotes(c: ContractBuilder, clockMode: ClockMode) {
  if (!c.parents.some(p => p.contract.name === 'ERC20Permit')) {
    throw new Error('Missing ERC20Permit requirement for ERC20Votes');
  }

  const ERC20Votes = {
    name: 'ERC20Votes',
    path: '@openzeppelin/contracts/token/ERC20/extensions/ERC20Votes.sol',
  };
  c.addParent(ERC20Votes);
  c.addOverride(ERC20Votes, functions._update);
  c.addOverride({
    name: 'Nonces',
  }, functions.nonces);

  setClockMode(c, ERC20Votes, clockMode);
}

function addFlashMint(c: ContractBuilder) {
  c.addParent({
    name: 'ERC20FlashMint',
    path: '@openzeppelin/contracts/token/ERC20/extensions/ERC20FlashMint.sol',
  });
}

const functions = defineFunctions({
  _update: {
    kind: 'internal' as const,
    args: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },

  mint: {
    kind: 'public' as const,
    args: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
  },

  pause: {
    kind: 'public' as const,
    args: [],
  },

  unpause: {
    kind: 'public' as const,
    args: [],
  },

  snapshot: {
    kind: 'public' as const,
    args: [],
  },

  nonces: {
    kind: 'public' as const,
    args: [
      { name: 'owner', type: 'address' },
    ],
    returns: ['uint256'],
    mutability: 'view' as const,
  },

  blockUser: {
    kind: 'public' as const,
    args: [{ name: 'user', type: 'address' }],
  },

  unblockUser: {
    kind: 'public' as const,
    args: [{ name: 'user', type: 'address' }],
  },

  allow: {
    kind: 'public' as const,
    args: [{ name: 'user', type: 'address' }],
  },

  unallow: {
    kind: 'public' as const,
    args: [{ name: 'user', type: 'address' }],
  },

  update: {
    kind: 'public' as const,
    args: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },

  _limit: {
    kind: 'internal' as const,
    args: [
      { name: 'account', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
  },
});
